"""In-process job queue — asyncio.Queue + a bounded worker pool.

The default backend and the Redis-absent degrade path. Behaviour matches
brain's prior detached-task model (create_task per run), but with an explicit
bounded pool and the per-user concurrency cap enforced by a UserGate.

Ephemeral by design: jobs live only in this process's memory. A crash loses
in-flight/queued jobs (at-most-once) — that is the accepted trade for running
with no Redis. Exactly-once FIRING is still preserved upstream by the G3
scheduler's durable next_fire_at CAS, so a lost scheduled job means a missed
window, never a double-fire. Use Redis (RedisQueue) for at-least-once
redelivery.
"""

from __future__ import annotations

import asyncio
import logging

from app.queue.base import Handler, Job, JobQueue, UserGate

log = logging.getLogger("brain.queue")


class InProcessQueue(JobQueue):
    backend = "in-process"

    def __init__(self, workers: int = 4, cap: int | None = None) -> None:
        self._n = max(1, workers)
        self._q: asyncio.Queue[Job] = asyncio.Queue()
        self._gate = UserGate() if cap is None else UserGate(cap)
        self._handler: Handler | None = None
        self._tasks: list[asyncio.Task] = []
        self._running = False

    async def enqueue(self, job: Job) -> None:
        await self._q.put(job)

    async def start(self, handler: Handler) -> None:
        if self._running:
            return
        self._handler = handler
        self._running = True
        self._tasks = [
            asyncio.create_task(self._worker(i), name=f"queue-worker-{i}")
            for i in range(self._n)
        ]
        log.info("in-process queue started workers=%d cap=%d", self._n, self._gate.cap)

    async def _worker(self, i: int) -> None:
        assert self._handler is not None
        while True:
            job = await self._q.get()
            try:
                # Per-user cap: acquiring the user's semaphore bounds this
                # user's concurrent runs. A capped user's overflow jobs block
                # here until a slot frees; other users' jobs run on free
                # workers.
                async with self._gate.semaphore(job.user_id):
                    await self._handler(job)
            except asyncio.CancelledError:
                # Shutdown (stop() cancels workers). Propagate cancellation
                # into the handler's run so it tears down cleanly.
                raise
            except Exception as exc:  # a bad job must never kill the worker
                log.warning("job %s (%s) failed: %s", job.id, job.kind, exc)
            finally:
                self._q.task_done()

    async def stop(self) -> None:
        self._running = False
        for t in self._tasks:
            t.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []

    def health(self) -> dict:
        return {
            "backend": self.backend,
            "running": self._running,
            "workers": self._n,
            "cap": self._gate.cap,
            "pending": self._q.qsize(),
        }
