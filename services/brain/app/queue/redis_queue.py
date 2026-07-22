"""Redis-backed job queue — detached runs with at-least-once redelivery.

Keys (all under the ``verity:jobs:`` namespace):
  * ``verity:jobs:pending``          LIST  — job ids awaiting a worker (LPUSH / RPOP).
  * ``verity:jobs:inflight``         ZSET  — claimed job ids scored by lease expiry.
  * ``verity:jobs:data:{id}``        STR   — the job JSON (survives across the lease).
  * ``verity:jobs:lease:{lease_id}`` STR   — per-RUN single-flight lock (NX EX).

Delivery contract:
  * enqueue: store the job JSON, LPUSH its id onto ``pending``.
  * claim:   RPOP an id, load its JSON, ZADD it to ``inflight`` with
             ``score = now + visibility_timeout``, then take the per-run lease
             (``SET lease NX EX``). If the lease is already held (the same
             office/run is executing elsewhere) the job is pushed back and the
             claim yields nothing — so the SAME office never double-runs.
  * success: ZREM inflight, DEL data, DEL lease.
  * crash:   nothing runs; the ZSET entry's score elapses and the reaper
             re-queues the id (attempts+1) — at-least-once redelivery. The
             per-run lease has its own TTL, so it frees for the redelivery.

This gives: exactly-once FIRING (upstream, via the scheduler's durable CAS),
no concurrent double-run (per-run lease), and crash recovery (visibility
timeout). The per-user concurrency cap is enforced worker-side by a UserGate
(per-replica), same as the in-process backend.

Boot degrades, never dies: constructing this needs the optional ``redis``
package and a reachable REDIS_URL; the factory in ``app.queue`` falls back to
the in-process queue when either is missing. A test may inject a client
(e.g. fakeredis) directly.
"""

from __future__ import annotations

import asyncio
import logging

from app.queue.base import Handler, Job, JobQueue, UserGate

log = logging.getLogger("brain.queue")

_NS = "verity:jobs"
PENDING = f"{_NS}:pending"
INFLIGHT = f"{_NS}:inflight"
MAX_ATTEMPTS = 5


class RedisQueue(JobQueue):
    backend = "redis"

    def __init__(
        self,
        url: str | None = None,
        *,
        client=None,
        workers: int = 4,
        cap: int | None = None,
        visibility_timeout: float = 300.0,
        lease_ttl: float = 330.0,
        poll_interval: float = 1.0,
        reap_interval: float = 30.0,
        time_fn=None,
    ) -> None:
        self._url = url
        self._client = client
        self._n = max(1, workers)
        self._gate = UserGate() if cap is None else UserGate(cap)
        self._vis = visibility_timeout
        self._lease_ttl = lease_ttl
        self._poll = poll_interval
        self._reap_interval = reap_interval
        # Injectable clock so the visibility timeout is testable without sleeps.
        self._time = time_fn or (lambda: __import__("time").time())
        self._handler: Handler | None = None
        self._tasks: list[asyncio.Task] = []
        self._running = False
        # Cooperative-shutdown signal. Workers/reaper poll on this instead of a
        # bare sleep so stop() can drain in-flight jobs to completion rather
        # than hard-cancelling a task mid-Redis-operation (which can leave the
        # connection wedged, and deadlocks fakeredis in tests). Constructed here
        # (no running loop needed in 3.10+); set by stop().
        self._stop_event = asyncio.Event()

    # --- lifecycle ---------------------------------------------------------

    async def _ensure_client(self):
        if self._client is None:
            # Lazy import: `redis` is an optional extra.
            from redis import asyncio as aioredis  # type: ignore

            self._client = aioredis.from_url(self._url, decode_responses=True)
        return self._client

    async def start(self, handler: Handler) -> None:
        if self._running:
            return
        await self._ensure_client()
        self._handler = handler
        self._running = True
        self._stop_event.clear()
        self._tasks = [
            asyncio.create_task(self._worker_loop(i), name=f"redis-worker-{i}")
            for i in range(self._n)
        ]
        self._tasks.append(asyncio.create_task(self._reaper_loop(), name="redis-reaper"))
        log.info("redis queue started workers=%d cap=%d", self._n, self._gate.cap)

    async def stop(self, grace: float = 5.0) -> None:
        """Graceful shutdown: signal the loops to exit at a safe point (between
        jobs, not mid-Redis-op) and let in-flight jobs finish. Only a straggler
        still running after `grace` is hard-cancelled — so a well-behaved job is
        never interrupted mid-operation."""
        self._running = False
        self._stop_event.set()
        if self._tasks:
            done, pending = await asyncio.wait(self._tasks, timeout=grace)
            for t in pending:  # a genuinely stuck task (e.g. a hung handler)
                t.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
        self._tasks = []

    async def _sleep_or_stop(self, timeout: float) -> None:
        """Sleep up to `timeout`, waking immediately on shutdown. Never lets a
        CancelledError-free stop hang on a long poll/reap interval."""
        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout)
        except asyncio.TimeoutError:
            pass

    # --- enqueue -----------------------------------------------------------

    async def enqueue(self, job: Job) -> None:
        client = await self._ensure_client()
        await client.set(self._data_key(job.id), job.to_json())
        await client.lpush(PENDING, job.id)

    # --- claim / complete / fail (deterministic units for the loops & tests) --

    async def _claim(self) -> Job | None:
        """Pop and lock one runnable job, or return None if nothing runnable.

        A popped job whose per-run lease is already held is pushed back (its
        office/run is executing elsewhere) and None is returned."""
        client = await self._ensure_client()
        job_id = await client.rpop(PENDING)
        if not job_id:
            return None
        raw = await client.get(self._data_key(job_id))
        if not raw:  # data gone (already completed) — nothing to do
            await client.zrem(INFLIGHT, job_id)
            return None
        job = Job.from_json(raw)
        # Per-run single-flight lease: only one worker runs this office/run.
        got = await client.set(
            self._lease_key(job.lease_id), job.id, nx=True, ex=int(self._lease_ttl)
        )
        if not got:
            await client.lpush(PENDING, job_id)  # requeue; another worker owns it
            return None
        await client.zadd(INFLIGHT, {job_id: self._time() + self._vis})
        return job

    async def _complete(self, job: Job) -> None:
        client = await self._ensure_client()
        await client.zrem(INFLIGHT, job.id)
        await client.delete(self._data_key(job.id))
        await self._release_lease(job)

    async def _fail(self, job: Job) -> None:
        """A handler error: release the lease and either retry or drop."""
        client = await self._ensure_client()
        await client.zrem(INFLIGHT, job.id)
        await self._release_lease(job)
        if job.attempts + 1 < MAX_ATTEMPTS:
            nxt = job.retry()
            await client.set(self._data_key(nxt.id), nxt.to_json())
            await client.lpush(PENDING, nxt.id)
        else:
            log.warning("job %s (%s) exhausted retries; dropping", job.id, job.kind)
            await client.delete(self._data_key(job.id))

    async def _release_lease(self, job: Job) -> None:
        client = await self._ensure_client()
        key = self._lease_key(job.lease_id)
        holder = await client.get(key)
        if holder == job.id:  # only release our own lease
            await client.delete(key)

    async def _reap(self) -> int:
        """Redeliver jobs whose visibility timeout elapsed (crashed worker).
        Returns the number redelivered."""
        client = await self._ensure_client()
        now = self._time()
        expired = await client.zrangebyscore(INFLIGHT, "-inf", now)
        redelivered = 0
        for job_id in expired:
            # Atomic-enough: remove from inflight then requeue. A double reap
            # would at worst enqueue twice; the per-run lease still prevents a
            # concurrent double-run, and the job is idempotent on its run row.
            removed = await client.zrem(INFLIGHT, job_id)
            if not removed:
                continue
            raw = await client.get(self._data_key(job_id))
            if not raw:
                continue
            job = Job.from_json(raw)
            nxt = job.retry()
            await client.set(self._data_key(nxt.id), nxt.to_json())
            await client.lpush(PENDING, nxt.id)
            if nxt.id != job_id:
                await client.delete(self._data_key(job_id))
            redelivered += 1
        return redelivered

    async def _run_job(self, job: Job) -> None:
        assert self._handler is not None
        try:
            async with self._gate.semaphore(job.user_id):
                await self._handler(job)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("job %s (%s) failed: %s", job.id, job.kind, exc)
            await self._fail(job)
            return
        await self._complete(job)

    # --- loops -------------------------------------------------------------

    async def _worker_loop(self, i: int) -> None:
        while self._running:
            try:
                job = await self._claim()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # transient Redis error: back off, retry
                log.warning("claim failed: %s", exc)
                job = None
            if job is None:
                await self._sleep_or_stop(self._poll)
                continue
            # A job claimed just as shutdown begins still runs to completion —
            # at-least-once favours finishing over abandoning in-flight work.
            await self._run_job(job)

    async def _reaper_loop(self) -> None:
        while self._running:
            await self._sleep_or_stop(self._reap_interval)
            if not self._running:
                break
            try:
                n = await self._reap()
                if n:
                    log.info("redelivered %d expired job(s)", n)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("reap failed: %s", exc)

    # --- keys --------------------------------------------------------------

    @staticmethod
    def _data_key(job_id: str) -> str:
        return f"{_NS}:data:{job_id}"

    @staticmethod
    def _lease_key(lease_id: str) -> str:
        return f"{_NS}:lease:{lease_id}"

    def health(self) -> dict:
        return {
            "backend": self.backend,
            "running": self._running,
            "workers": self._n,
            "cap": self._gate.cap,
        }
