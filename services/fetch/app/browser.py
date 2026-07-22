"""Headless-Chromium lifecycle + a single guarded render path.

Degrade, never die (plan law): if Chromium cannot launch, the service still
boots. ``/healthz`` reports ``browser_ok: false`` and ``/fetch`` returns a clear
503-style error instead of crashing.

Resource safety, all enforced here:
  * one fresh context + page per request, torn down in ``finally``;
  * a concurrency semaphore bounds simultaneous renders;
  * a hard navigation timeout;
  * a route handler that (a) SSRF-re-checks every request URL — catching redirects
    to, and subresource loads of, blocked hosts — and (b) aborts heavy resource
    types to bound bandwidth;
  * downloads are refused (``accept_downloads=False`` + cancel);
  * the rendered DOM is size-capped before extraction.

Never logs page bodies or full URLs (query strings can carry tokens) — only
scheme+host, outcome, byte count, and elapsed time.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from playwright.async_api import (
    Browser,
    Error as PlaywrightError,
    Playwright,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

from app import extract as extract_mod
from app.config import Settings, settings
from app.ssrf import SSRFError, validate_url, validate_url_async

log = logging.getLogger("fetch.browser")

# Schemes the browser may follow without a network SSRF check (no host to reach).
_LOCAL_SCHEMES = {"data", "about", "blob"}


class BrowserUnavailable(RuntimeError):
    """Chromium is not running — the caller should surface a 503."""


class FetchError(RuntimeError):
    """Navigation or rendering failed for a reason that isn't an SSRF block."""


@dataclass
class RenderResult:
    final_url: str
    title: str
    markdown: str
    truncated: bool


@dataclass
class _RequestGuard:
    """Per-render state for the route handler: an SSRF result cache and the record
    of a blocked *main-frame navigation* (which must fail the whole fetch)."""

    allowed_ports: frozenset
    block_types: frozenset
    cache: dict[str, bool] = field(default_factory=dict)
    nav_block_reason: str | None = None
    subresource_blocks: int = 0


class BrowserManager:
    """Owns the Playwright + Chromium process and the render semaphore."""

    def __init__(self, cfg: Settings = settings):
        self._cfg = cfg
        self._pw: Playwright | None = None
        self._browser: Browser | None = None
        self._launch_error: str | None = None
        self._sem = asyncio.Semaphore(max(1, cfg.max_concurrency))

    # ---- lifecycle ------------------------------------------------------
    async def start(self) -> None:
        """Best-effort launch. Any failure is recorded and the service continues
        degraded rather than crashing at boot."""
        try:
            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",               # container-friendly; no setuid helper
                    "--disable-dev-shm-usage",    # avoid /dev/shm exhaustion in Docker
                    "--disable-gpu",
                ],
            )
            self._launch_error = None
            log.info("chromium launched (headless)")
        except Exception as exc:  # noqa: BLE001 — degrade on ANY launch failure
            self._launch_error = f"{type(exc).__name__}: {exc}"
            self._browser = None
            log.warning("chromium launch failed; serving degraded: %s", type(exc).__name__)

    async def stop(self) -> None:
        try:
            if self._browser is not None:
                await self._browser.close()
        finally:
            if self._pw is not None:
                await self._pw.stop()
            self._browser = None
            self._pw = None

    @property
    def browser_ok(self) -> bool:
        return self._browser is not None and self._browser.is_connected()

    @property
    def launch_error(self) -> str | None:
        return self._launch_error

    def health(self) -> dict:
        return {
            "browser_ok": self.browser_ok,
            "launch_error": self._launch_error,
            "max_concurrency": self._cfg.max_concurrency,
        }

    # ---- render ---------------------------------------------------------
    async def render(
        self, url: str, mode: str, timeout_ms: int, max_bytes: int
    ) -> RenderResult:
        if not self.browser_ok:
            raise BrowserUnavailable(self._launch_error or "browser not launched")

        # PRE-NAVIGATION SSRF gate: reject before a page is ever created.
        validate_url(url, self._cfg.allowed_port_set)

        guard = _RequestGuard(
            allowed_ports=self._cfg.allowed_port_set,
            block_types=self._cfg.block_resource_type_set,
        )
        proxy = self._cfg.proxy_config()
        started = time.monotonic()
        host = urlsplit(url).hostname or "?"

        async with self._sem:
            context = await self._browser.new_context(
                user_agent=self._cfg.user_agent,
                accept_downloads=False,
                java_script_enabled=True,
                ignore_https_errors=False,
                proxy=proxy,
            )
            try:
                context.on("download", lambda d: asyncio.create_task(_safe_cancel(d)))
                await context.route("**/*", self._make_route_handler(guard))
                page = await context.new_page()

                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                except (PlaywrightTimeoutError, PlaywrightError) as exc:
                    # A blocked main-frame navigation (e.g. a redirect to the
                    # metadata IP) surfaces here as an aborted request — translate
                    # it back into the precise SSRF reason.
                    if guard.nav_block_reason is not None:
                        raise SSRFError(guard.nav_block_reason) from exc
                    raise FetchError(_short_pw_error(exc)) from exc

                # Best-effort settle so JS-rendered content appears, strictly bounded.
                try:
                    await page.wait_for_load_state("networkidle", timeout=self._cfg.settle_ms)
                except PlaywrightTimeoutError:
                    pass

                final_url = page.url
                dom_title = await page.title()
                html = await page.content()
            finally:
                await context.close()

        # A subresource redirect to a blocked host after load still counts as an
        # SSRF attempt on the main frame — fail closed.
        if guard.nav_block_reason is not None:
            raise SSRFError(guard.nav_block_reason)

        capped_html, html_truncated = extract_mod.apply_size_cap(html, max_bytes)
        title, markdown = extract_mod.extract(capped_html, mode)
        if not title:
            title = (dom_title or "").strip()

        md_truncated = False
        if len(markdown) > self._cfg.max_markdown_chars:
            markdown = markdown[: self._cfg.max_markdown_chars]
            md_truncated = True

        elapsed = int((time.monotonic() - started) * 1000)
        log.info(
            "fetched host=%s outcome=ok bytes=%d truncated=%s subresource_blocks=%d elapsed_ms=%d",
            host, len(html), html_truncated or md_truncated, guard.subresource_blocks, elapsed,
        )
        return RenderResult(
            final_url=final_url,
            title=title,
            markdown=markdown,
            truncated=html_truncated or md_truncated,
        )

    def _make_route_handler(self, guard: _RequestGuard):
        async def handle(route):
            request = route.request
            req_url = request.url
            parts = urlsplit(req_url)
            scheme = parts.scheme.lower()
            is_nav = request.is_navigation_request()

            # data:/about:/blob: reach no host — allow (needed for data-URL renders).
            if scheme in _LOCAL_SCHEMES:
                await route.continue_()
                return

            # Bandwidth guard: drop heavy subresources that never carry text.
            if not is_nav and request.resource_type in guard.block_types:
                await route.abort()
                return

            key = f"{scheme}://{parts.hostname}:{parts.port or ''}"
            ok = guard.cache.get(key)
            if ok is None:
                try:
                    await validate_url_async(req_url, guard.allowed_ports)
                    guard.cache[key] = True
                    ok = True
                except SSRFError as exc:
                    guard.cache[key] = False
                    ok = False
                    if is_nav:
                        guard.nav_block_reason = str(exc)
                    else:
                        guard.subresource_blocks += 1
                        log.warning("ssrf-blocked subresource host=%s", parts.hostname)
            elif ok is False and is_nav:
                guard.nav_block_reason = (
                    f"navigation to blocked host {parts.hostname!r}"
                )

            if ok:
                await route.continue_()
            else:
                await route.abort()

        return handle


async def _safe_cancel(download) -> None:
    try:
        await download.cancel()
    except Exception:  # noqa: BLE001 — cancellation is best-effort
        pass


def _short_pw_error(exc: Exception) -> str:
    """First line of a Playwright error, without the multi-line call log/body."""
    return str(exc).splitlines()[0][:200] if str(exc) else type(exc).__name__


# Module-level singleton wired into the FastAPI lifespan.
manager = BrowserManager()
