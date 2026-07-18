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
    grpc_addr = os.environ.get("BRAIN_GRPC_ADDR", "127.0.0.1:9100")
    server = await grpc_server.serve(grpc_addr)
    yield
    await server.stop(grace=2.0)


app = FastAPI(title="verity-brain", version=VERSION, docs_url=None, redoc_url=None, lifespan=lifespan)


@app.get("/healthz")
async def healthz() -> dict:
    missing = settings.missing()
    return {
        "status": "degraded" if missing else "ok",
        "service": "brain",
        "version": VERSION,
        "missing_config": missing,
    }
