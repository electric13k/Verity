"""Verity fetch service — headless-browser render-to-markdown (backlog G11).

A PRIVATE service: no published ports, reachable only from the brain over the
compose ``private`` network. It is the SSRF boundary for the brain's ``web_fetch``
tool — the brain hands it a model-chosen URL and never dereferences URLs itself.

Contract (must match services/brain/app/tools/web.py exactly):

    POST /fetch
      request : {url, mode?, timeout_ms?, max_bytes?}
      response: {final_url, title, markdown, truncated, fetched_at}   (200)

    GET /healthz  ->  200 always (liveness), body reports whether Chromium launched

``mode`` accepts both vocabularies: the brain sends ``markdown``/``text``; the spec
names ``readable``/``raw``. ``markdown``≡``readable`` (default), ``text``≡``raw``.

The returned markdown is UNTRUSTED content: the brain wrapUntrusts + BOP-sanitizes
it before it re-enters any prompt. This service treats it purely as data — it
never executes or follows it.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.browser import BrowserUnavailable, FetchError, manager
from app.config import clamp_max_bytes, clamp_timeout_ms, settings
from app.extract import normalize_mode
from app.ssrf import SSRFError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("fetch.main")


class FetchRequest(BaseModel):
    model_config = {"extra": "ignore"}
    url: str
    mode: str | None = None
    timeout_ms: int | None = Field(default=None, ge=0)
    max_bytes: int | None = Field(default=None, ge=0)


class FetchResponse(BaseModel):
    final_url: str
    title: str
    markdown: str
    truncated: bool
    fetched_at: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Best-effort browser launch; boot degrades, never dies.
    await manager.start()
    if manager.browser_ok:
        log.info("fetch service ready (browser up)")
    else:
        log.warning("fetch service ready DEGRADED (browser down): %s", manager.launch_error)
    try:
        yield
    finally:
        await manager.stop()


app = FastAPI(title="verity-fetch", version="0.1.0", lifespan=lifespan)


@app.get("/healthz")
async def healthz() -> JSONResponse:
    # Always 200 (liveness). Body reports readiness so a degraded browser is
    # observable without failing the container's healthcheck.
    h = manager.health()
    body = {
        "status": "ok" if h["browser_ok"] else "degraded",
        "service": "verity-fetch",
        **h,
    }
    return JSONResponse(body, status_code=200)


def _error(status: int, error: str, detail: str) -> JSONResponse:
    return JSONResponse({"error": error, "detail": detail}, status_code=status)


@app.post("/fetch")
async def fetch(req: FetchRequest):
    url = (req.url or "").strip()
    if not url:
        return _error(400, "invalid_request", "url is required")

    mode = normalize_mode(req.mode)
    timeout_ms = clamp_timeout_ms(req.timeout_ms, settings)
    max_bytes = clamp_max_bytes(req.max_bytes, settings)

    try:
        result = await manager.render(url, mode, timeout_ms, max_bytes)
    except SSRFError as exc:
        # Target failed the SSRF allowlist — rejected before/at navigation.
        log.warning("fetch rejected (ssrf): %s", exc)
        return _error(400, "blocked", str(exc))
    except BrowserUnavailable as exc:
        log.warning("fetch unavailable (browser down)")
        return _error(503, "browser_unavailable", str(exc))
    except FetchError as exc:
        log.info("fetch failed: %s", exc)
        return _error(502, "fetch_failed", str(exc))

    return FetchResponse(
        final_url=result.final_url,
        title=result.title,
        markdown=result.markdown,
        truncated=result.truncated,
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )
