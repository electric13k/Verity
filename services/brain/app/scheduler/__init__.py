"""G3 office scheduler — public surface + the process-wide singleton.

``office_scheduler`` is the cron ticker the FastAPI lifespan starts (and stops).
It enqueues due office runs onto the SAME ``app.queue.job_queue`` singleton the
workers drain, so scheduled and manual runs share one detached execution path.

Construction does no I/O (safe at import): the Redis tick-lease client, if any,
is created lazily on the first tick, and croniter is imported lazily by
``app.scheduler.cron``. Boot degrades, never dies.
"""

from __future__ import annotations

from app.scheduler import cron
from app.scheduler.core import OfficeScheduler
from app.scheduler.cron import next_fire


def build_scheduler(queue=None) -> OfficeScheduler:
    """Build the scheduler bound to the shared run queue and configured Redis
    (for the tick lease). Pure — no connect happens here."""
    from app.config import settings
    from app.queue import job_queue

    return OfficeScheduler(queue=queue or job_queue, redis_url=settings.redis_url)


# Process-wide singleton (constructed, not started; the lifespan calls .start()).
office_scheduler: OfficeScheduler = build_scheduler()


__all__ = [
    "OfficeScheduler",
    "office_scheduler",
    "build_scheduler",
    "cron",
    "next_fire",
]
