"""Verity brain — FastAPI service. Private subnet only; reached through the
gateway. Tenant identity arrives in gRPC metadata / trusted headers injected
by the gateway — never read from request bodies.
"""

import logging

from fastapi import FastAPI

from app.config import settings

VERSION = "0.1.0"

logging.basicConfig(
    level=logging.INFO,
    format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
)
log = logging.getLogger("brain")

app = FastAPI(title="verity-brain", version=VERSION, docs_url=None, redoc_url=None)


@app.on_event("startup")
async def report_degraded() -> None:
    missing = settings.missing()
    if missing:
        log.warning("starting degraded; missing config: %s", ", ".join(missing))


@app.get("/healthz")
async def healthz() -> dict:
    missing = settings.missing()
    return {
        "status": "degraded" if missing else "ok",
        "service": "brain",
        "version": VERSION,
        "missing_config": missing,
    }
