"""Runtime configuration for the fetch service.

Boot-degrades law: every value has a safe default, so the service starts with an
empty environment and ``/healthz`` reports readiness. Nothing here is required.
All knobs are env-overridable (prefix ``FETCH_``) for operators without a code
change. No secrets live here — the service holds none.
"""

from __future__ import annotations

import os

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.ssrf import parse_allowed_ports


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FETCH_", extra="ignore")

    # Navigation time budget. The caller may pass ``timeout_ms`` per request, but
    # it is clamped into [1s, max_timeout_ms] so a caller can neither hang the
    # worker forever nor set an unusably tiny budget.
    default_timeout_ms: int = 30_000       # matches the brain's web_fetch default
    max_timeout_ms: int = 60_000           # hard ceiling on caller-supplied timeout
    # Extra best-effort settle for JS-driven pages after DOMContentLoaded (bounded
    # so a page that never goes idle can't stall past this).
    settle_ms: int = 2_000

    # Response size cap. The rendered DOM is truncated to ``max_bytes`` before
    # extraction; the resulting markdown is capped at ``max_markdown_chars``.
    # Either trip sets ``truncated: true`` in the response.
    max_bytes: int = 2_000_000             # matches the brain's web_fetch default
    max_markdown_chars: int = 400_000

    # Concurrency semaphore — how many pages render at once. Bounds RAM/CPU under
    # load; excess requests queue (fair) rather than thrash the box.
    max_concurrency: int = 4

    # Web-port allowlist (comma list). Defaults to real web ports only.
    allowed_ports: str = "80,443"

    # A plain, honest desktop UA. Not spoofing a specific brand; enough that sites
    # serve their normal HTML rather than a bot-blocked stub.
    user_agent: str = (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "VerityFetch/0.1 Safari/537.36"
    )

    # Resource types aborted in the route handler to bound bandwidth (they never
    # affect extracted text). Comma list of Playwright resource types.
    block_resource_types: str = "media,font,image"

    # Optional explicit proxy for the headless browser. When unset the service
    # falls back to HTTPS_PROXY / HTTP_PROXY from the environment (the dev/agent
    # proxy); in production egress it is simply unset and the browser dials directly.
    proxy_url: str | None = None

    @property
    def allowed_port_set(self):
        return parse_allowed_ports(self.allowed_ports)

    @property
    def block_resource_type_set(self) -> frozenset[str]:
        return frozenset(
            t.strip().lower() for t in self.block_resource_types.split(",") if t.strip()
        )

    def effective_proxy(self) -> str | None:
        """Explicit ``FETCH_PROXY_URL`` wins; otherwise honor the standard proxy
        env vars so Playwright routes through a forward/egress proxy when one is
        configured (e.g. the agent proxy in this environment). Unset in normal
        production egress → the browser dials directly."""
        return (
            self.proxy_url
            or os.environ.get("HTTPS_PROXY")
            or os.environ.get("https_proxy")
            or os.environ.get("HTTP_PROXY")
            or os.environ.get("http_proxy")
        )

    def proxy_bypass(self) -> str | None:
        """NO_PROXY, translated to Playwright's ``proxy.bypass`` domain-suffix
        form, so hosts meant to be reached directly (the standard NO_PROXY set)
        skip the proxy — matching pip/curl/etc. CIDR/IP entries are dropped
        (Playwright bypass matches by domain, and the SSRF guard already forbids
        internal addresses regardless of proxy routing)."""
        raw = os.environ.get("NO_PROXY") or os.environ.get("no_proxy")
        if not raw:
            return None
        out: list[str] = []
        for entry in raw.split(","):
            entry = entry.strip()
            if not entry or not any(c.isalpha() for c in entry):
                continue  # skip IPs / CIDRs — keep only host/domain entries
            out.append(entry[1:] if entry.startswith("*") else entry)  # *.x -> .x
        return ",".join(out) or None

    def proxy_config(self) -> dict | None:
        """Full Playwright proxy option ({server, bypass?}) or None for direct."""
        server = self.effective_proxy()
        if not server:
            return None
        cfg: dict = {"server": server}
        bypass = self.proxy_bypass()
        if bypass:
            cfg["bypass"] = bypass
        return cfg


settings = Settings()


def clamp_timeout_ms(requested: int | None, s: Settings = settings) -> int:
    """Clamp a caller-supplied timeout into [1000, max_timeout_ms]; ``None`` →
    the configured default. Pure + deterministic → unit-tested without a browser."""
    if requested is None:
        return s.default_timeout_ms
    try:
        value = int(requested)
    except (TypeError, ValueError):
        return s.default_timeout_ms
    return max(1_000, min(value, s.max_timeout_ms))


def clamp_max_bytes(requested: int | None, s: Settings = settings) -> int:
    """Clamp a caller-supplied byte cap into [1KiB, max_bytes]; ``None`` → the
    configured default. A caller can shrink the cap but never raise it above the
    service ceiling."""
    if requested is None:
        return s.max_bytes
    try:
        value = int(requested)
    except (TypeError, ValueError):
        return s.max_bytes
    return max(1_024, min(value, s.max_bytes))
