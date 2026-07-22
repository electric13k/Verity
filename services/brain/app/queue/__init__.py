"""G12 async run queue — public surface + the degrade-aware backend factory.

``job_queue`` is the process-wide singleton the servicer and the G3 scheduler
enqueue onto and the FastAPI lifespan starts. ``build_queue`` chooses the
backend once, at import, with no I/O:

    REDIS_URL set AND `redis` importable  → RedisQueue  (at-least-once, leased)
    otherwise                             → InProcessQueue (bounded pool)

Law: boot degrades, never dies — REDIS_URL absent, or the optional `redis`
package missing, silently selects the in-process queue (logged once). No new
REQUIRED env; queue tunables read from the environment with safe defaults.
"""

from __future__ import annotations

import logging
import os

from app.config import settings
from app.queue.base import Handler, Job, JobQueue, UserGate
from app.queue.inprocess import InProcessQueue

log = logging.getLogger("brain.queue")


def _workers() -> int:
    try:
        return max(1, int(os.environ.get("VERITY_QUEUE_WORKERS", "4")))
    except ValueError:
        return 4


def build_queue() -> JobQueue:
    """Select the queue backend. Pure (no connect); safe at import time."""
    url = settings.redis_url
    if url:
        try:
            import redis  # noqa: F401  (optional extra; presence check only)

            from app.queue.redis_queue import RedisQueue

            log.info("run queue: redis backend selected")
            return RedisQueue(url=url, workers=_workers())
        except Exception as exc:  # package missing / import error → degrade
            log.warning(
                "REDIS_URL set but redis backend unavailable (%s); "
                "run queue degraded to in-process",
                exc,
            )
    return InProcessQueue(workers=_workers())


# Process-wide singleton. Constructed (not started) at import; the lifespan
# calls .start(handler). Healthz reads .health() at any time.
job_queue: JobQueue = build_queue()


__all__ = [
    "Handler",
    "Job",
    "JobQueue",
    "UserGate",
    "InProcessQueue",
    "build_queue",
    "job_queue",
]
