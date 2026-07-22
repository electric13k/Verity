"""Standalone run-queue worker — ``python -m app.worker`` (G12).

Runs the same job queue and ``dispatch`` handler the FastAPI lifespan starts,
but as its own process so office/flow runs scale out independently of the API
replicas. With a reachable REDIS_URL the worker consumes the shared durable
queue (at-least-once redelivery, per-office single-flight lease); with no
REDIS_URL it runs the in-process asyncio queue — which only drains jobs
enqueued in THIS process, so for the in-process backend the producer (API +
scheduler) and the worker must share one process to be useful. The API lifespan
already starts an in-process worker pool, so this standalone module is aimed at
the Redis backend.

Boot degrades, never dies: the DB is connected if configured (handlers need it)
and the queue starts regardless; missing config is logged, never fatal. SIGINT
/ SIGTERM drain and stop the pool cleanly.
"""

from __future__ import annotations

import asyncio
import logging
import signal

from app.db import db
from app.queue import job_queue
from app.queue.handlers import dispatch

log = logging.getLogger("brain.worker")


async def _run() -> None:
    await db.connect()  # degrades to no-pool when DATABASE_URL is absent
    await job_queue.start(dispatch)
    log.info("run-queue worker started backend=%s", job_queue.backend)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # e.g. Windows / no event loop signals
            pass

    await stop.wait()
    log.info("run-queue worker stopping")
    await job_queue.stop()
    await db.close()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
    )
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:  # pragma: no cover - interactive Ctrl-C
        pass


if __name__ == "__main__":
    main()
