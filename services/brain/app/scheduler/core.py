"""G3 office scheduler — the cron ticker that actually fires scheduled offices.

Each tick (default 45s) the scheduler:

  1. takes a best-effort per-window Redis *tick lease* so only ONE replica
     scans per window — a thundering-herd guard on the DB, NOT the correctness
     anchor. With no Redis it degrades to a single-process guard (this replica
     scans; the CAS below still makes multi-process safe).
  2. reads the due offices via ``offices_repo.due_for_scheduling`` — the single
     sanctioned cross-tenant read; each row carries its OWNER user_id.
  3. for each due office computes the next window and CLAIMS it with a durable
     compare-and-swap on ``next_fire_at`` (``offices_repo.claim_fire``). The CAS
     is the real exactly-once-per-window anchor: it holds across ticks,
     restarts and replicas, WITH OR WITHOUT Redis. Claiming happens BEFORE the
     enqueue, so a crash between claim and enqueue is a missed window (safe),
     never a double-fire.
  4. enqueues exactly one office Job — owner user_id set server-side, never from
     a request — onto the shared run queue. A worker executes it later, capped
     per-user by the queue's UserGate.

Newly-seen offices (``next_fire_at IS NULL``) are SEEDED to their next future
window and NOT fired: history is never back-filled.

Laws / degrade-never-die:
  * tenant — acts on each office's STORED owner user_id (server-side); every
    write re-binds to it. The cross-tenant read is scheduler-only.
  * no croniter → no fire times → nothing scheduled (logged once; /healthz).
  * no Redis → single-process tick guard (CAS still guarantees exactly-once).
  * DB down → the tick logs and returns; the ticker keeps running.
  * no new REQUIRED env; all toggles have safe defaults.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from datetime import datetime, timezone

from app.db import DBUnavailable
from app.queue.base import Job
from app.repos import offices as offices_repo
from app.scheduler import cron

log = logging.getLogger("brain.scheduler")

DEFAULT_TICK_SECONDS = 45.0


def _env_tick() -> float:
    try:
        return max(5.0, float(os.environ.get("VERITY_SCHEDULER_TICK_SECONDS", "45")))
    except ValueError:
        return DEFAULT_TICK_SECONDS


def _env_enabled() -> bool:
    return os.environ.get("VERITY_SCHEDULER_ENABLED", "1").lower() not in (
        "0", "false", "no", "off",
    )


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class _TickCoordinator:
    """Per-window scan lease. Redis-backed when a URL/client is available,
    otherwise a local single-process guard (``acquire`` always grants)."""

    def __init__(self, *, url: str | None = None, client=None, tick_seconds: float = 45.0):
        self._url = url
        self._client = client
        self._tick = max(1.0, tick_seconds)
        self._checked = False
        self.backend = "redis" if (client is not None or url) else "local"

    async def _get_client(self):
        if self._client is not None:
            return self._client
        if not self._url or self._checked:
            return None
        self._checked = True
        try:
            from redis import asyncio as aioredis  # optional extra

            self._client = aioredis.from_url(self._url, decode_responses=True)
        except Exception as exc:  # package missing / bad url → local guard
            log.warning(
                "scheduler: redis tick-lease unavailable (%s); single-process guard",
                exc,
            )
            self._client = None
            self.backend = "local"
        return self._client

    async def acquire(self, now: datetime) -> bool:
        client = await self._get_client()
        if client is None:
            return True  # local guard: this replica scans
        window = int(now.timestamp() // self._tick)
        key = f"verity:sched:tick:{window}"
        try:
            got = await client.set(key, "1", nx=True, ex=int(self._tick) + 5)
            return bool(got)
        except Exception as exc:  # transient Redis error → scan anyway (CAS dedups)
            log.warning("scheduler: tick-lease error (%s); scanning anyway", exc)
            return True


class OfficeScheduler:
    def __init__(
        self,
        queue,
        *,
        repo=offices_repo,
        tick_seconds: float | None = None,
        enabled: bool | None = None,
        redis_url: str | None = None,
        redis_client=None,
        time_fn=None,
    ) -> None:
        self._queue = queue
        self._repo = repo
        self._tick = tick_seconds if tick_seconds is not None else _env_tick()
        self._enabled = _env_enabled() if enabled is None else enabled
        self._time = time_fn or _utcnow
        self._coord = _TickCoordinator(
            url=redis_url, client=redis_client, tick_seconds=self._tick
        )
        self._task: asyncio.Task | None = None
        self._running = False
        self._ticks = 0
        self._fired = 0

    # --- lifecycle ---------------------------------------------------------

    async def start(self) -> None:
        if not self._enabled:
            log.info("office scheduler disabled (VERITY_SCHEDULER_ENABLED=0)")
            return
        if self._running:
            return
        if not cron.available():
            log.warning(
                "office scheduler started but croniter is absent; no office will fire"
            )
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="office-scheduler")
        log.info(
            "office scheduler started tick=%.0fs coordination=%s",
            self._tick, self._coord.backend,
        )

    async def stop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _loop(self) -> None:
        while self._running:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # a bad tick must never kill the ticker
                log.warning("scheduler tick failed: %s", exc)
            await asyncio.sleep(self._tick)

    # --- one pass (deterministic unit; tests call this directly) -----------

    async def tick(self) -> None:
        self._ticks += 1
        now = self._time()
        # Best-effort scan lease: another replica already owns this window.
        if not await self._coord.acquire(now):
            return
        # No cron engine → nothing can be scheduled.
        if not cron.available():
            return
        try:
            due = await self._repo.due_for_scheduling(now)
        except DBUnavailable:
            return  # persistence down; try again next tick
        except Exception as exc:
            log.warning("scheduler: due scan failed: %s", exc)
            return
        for office in due:
            try:
                await self._process(office, now)
            except Exception as exc:  # one bad office never stalls the scan
                log.warning("scheduler: office %s failed: %s", office.id, exc)

    async def _process(self, office, now: datetime) -> None:
        nxt = cron.next_fire(office.schedule_cron, now)
        if nxt is None:
            return  # invalid cron (logged in cron.next_fire) — skip
        if office.next_fire_at is None:
            # First sighting: seed the next future window, do NOT fire.
            await self._repo.seed_next_fire(office.user_id, office.id, nxt)
            return
        # Due window: claim it (advancing next_fire_at) BEFORE enqueuing.
        window = office.next_fire_at
        claimed = await self._repo.claim_fire(office.user_id, office.id, window, nxt)
        if not claimed:
            return  # another tick/replica won this window
        run_id = await self._repo.start_run(office.user_id, office.id)
        job = Job(
            kind="office",
            user_id=office.user_id,
            payload={"office_id": office.id, "run_id": run_id},
        )
        try:
            await self._queue.enqueue(job)
        except Exception as exc:  # window already advanced → never double-fires
            log.warning("scheduler: enqueue for office %s failed: %s", office.id, exc)
            with contextlib.suppress(Exception):
                await self._repo.finish_run(
                    office.user_id, run_id, "failed", f"enqueue failed: {exc}"
                )
            return
        self._fired += 1
        log.info("scheduler: fired office %s window=%s run=%s", office.id, window, run_id)

    # --- health ------------------------------------------------------------

    def health(self) -> dict:
        return {
            "enabled": self._enabled,
            "running": self._running,
            "cron": "croniter" if cron.available() else "unavailable",
            "coordination": self._coord.backend,
            "tick_seconds": self._tick,
            "ticks": self._ticks,
            "fired": self._fired,
        }
