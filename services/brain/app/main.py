"""Verity brain — FastAPI (HTTP probes) + gRPC (gateway-facing API).

Private subnet only; reached through the gateway. Tenant identity arrives
in gRPC metadata injected by the gateway — never read from request bodies.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app import grpc_server
from app.db import db
from app.queue import job_queue
from app.queue.handlers import dispatch
from app.scheduler import office_scheduler

VERSION = "0.1.0"

logging.basicConfig(
    level=logging.INFO,
    format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
)
log = logging.getLogger("brain")


@asynccontextmanager
async def lifespan(app: FastAPI):
    missing = settings.missing()
    if missing:
        log.warning("starting degraded; missing config: %s", ", ".join(missing))
    await db.connect()  # degrades to no-pool when DATABASE_URL is absent/unreachable
    grpc_addr = os.environ.get("BRAIN_GRPC_ADDR", "127.0.0.1:9100")
    server = await grpc_server.serve(grpc_addr)
    # G12 async run queue: start the worker pool (in-process by default; Redis
    # when REDIS_URL is set). Detached office/flow runs execute here.
    await job_queue.start(dispatch)
    # G3 office scheduler: start the cron ticker. Degrades silently when
    # croniter/Redis are absent (no fire / single-process guard).
    await office_scheduler.start()
    yield
    await office_scheduler.stop()
    await job_queue.stop()
    await server.stop(grace=2.0)
    await db.close()


app = FastAPI(title="verity-brain", version=VERSION, docs_url=None, redoc_url=None, lifespan=lifespan)


@app.get("/healthz")
async def healthz() -> dict:
    missing = settings.missing()
    return {
        "status": "degraded" if missing else "ok",
        "service": "brain",
        "version": VERSION,
        "missing_config": missing,
        "db": db.available,  # false = persistence RPCs answer UNAVAILABLE
        "redis": {"configured": bool(settings.redis_url)},
        "queue": job_queue.health(),          # backend (in-process|redis), workers, cap
        "scheduler": office_scheduler.health(),  # enabled/running, cron+coordination status
    }
