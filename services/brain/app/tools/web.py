"""G2 web tools — URL fetch + web search, callable by the model.

Two tools register into the same G1 registry as skills/MCP, so their results
ride the identical untrusted-content choke point (``prompt_safe``: BOP-sanitize
+ wrapUntrusted) before re-entering a prompt — a hostile page or search snippet
is inert data the model may read but not obey.

SSRF posture:
  * ``web_fetch`` talks ONLY to the internal headless-browser fetch service
    (backlog G11) at ``FETCH_SERVICE_URL`` and hands it the model-chosen url as
    a body field. That service is the SSRF boundary: it resolves + validates the
    target and renders it. The brain never dereferences the arbitrary url
    itself, so no SSRF surface is added here.
  * ``web_search`` talks ONLY to the one configured search provider endpoint
    (Tavily / Brave / SearXNG) — never to a model-supplied host — so it presents
    no SSRF surface either.

Degrade, never die: with the fetch service unreachable ``web_fetch`` returns a
clean "web fetch unavailable" result; with no search provider configured
``web_search`` returns a clear "search not configured" result and NEVER
fabricates hits. Both are always advertised; being unconfigured is a runtime
degrade, not an absent tool.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import settings
from app.tenant import TenantCtx
from app.tools.base import Tool, ToolResult, prompt_safe

log = logging.getLogger("brain.tools.web")

_FETCH_TIMEOUT_S = 30.0
_FETCH_MAX_BYTES = 2_000_000
_SEARCH_TIMEOUT_S = 15.0
_MAX_RESULTS = 8
_SNIPPET_CAP = 500
_MARKDOWN_CAP = 40_000  # cap fetched page text before wrapping (defense in depth)


class WebFetchTool(Tool):
    """Fetch a URL as markdown via the headless-browser fetch service (G11).

    Contract (POST ``{FETCH_SERVICE_URL}/fetch``):
        request  {url, mode?, timeout_ms?, max_bytes?}
        response {final_url, title, markdown, truncated}
    """

    name = "web_fetch"
    description = (
        "Fetch a web page by URL and return its main content as markdown. "
        "Renders JavaScript pages. Use to read a specific page the user names or "
        "that web_search surfaced. Returns the final URL (after redirects), the "
        "page title, and the page text."
    )
    parameters = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "Absolute http(s) URL to fetch."},
            "mode": {
                "type": "string",
                "enum": ["markdown", "text"],
                "description": "Extraction mode; defaults to markdown.",
            },
        },
        "required": ["url"],
    }

    def __init__(self, client: httpx.AsyncClient | None = None, sink: list | None = None):
        # ``client`` is injectable for tests; ``sink`` (when set) records visited
        # sources for research citation.
        self._client = client
        self._sink = sink

    async def run(self, args: dict, tenant: TenantCtx) -> ToolResult:
        url = (args.get("url") or "").strip()
        if not url:
            return ToolResult(
                prompt_safe("no url provided", source="web_fetch"), is_error=True
            )
        base = (settings.fetch_service_url or "").rstrip("/")
        if not base:
            return ToolResult(
                prompt_safe(
                    "web fetch is unavailable (fetch service not configured on this server)",
                    source="web_fetch",
                ),
            )
        payload = {
            "url": url,
            "mode": args.get("mode") or "markdown",
            "timeout_ms": int(_FETCH_TIMEOUT_S * 1000),
            "max_bytes": _FETCH_MAX_BYTES,
        }
        client = self._client or httpx.AsyncClient(timeout=_FETCH_TIMEOUT_S)
        try:
            resp = await client.post(f"{base}/fetch", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:  # unreachable / bad response → clean degrade
            log.warning("web_fetch degraded (fetch service): %s", type(exc).__name__)
            return ToolResult(
                prompt_safe(
                    "web fetch unavailable (the fetch service could not be reached "
                    "or returned an error); no page content was retrieved",
                    source="web_fetch",
                ),
            )
        final_url = str(data.get("final_url") or url)
        title = str(data.get("title") or "")
        markdown = str(data.get("markdown") or "")[:_MARKDOWN_CAP]
        truncated = bool(data.get("truncated"))
        if self._sink is not None:
            self._sink.append({"url": final_url, "title": title})
        body = (
            f"Fetched page\nurl: {final_url}\ntitle: {title}\n"
            f"truncated: {truncated}\n\n{markdown}"
        )
        return ToolResult(prompt_safe(body, source=f"web_fetch:{final_url}"))


# --- search backends -----------------------------------------------------


@dataclass(frozen=True)
class SearchHit:
    title: str
    url: str
    snippet: str


class SearchUnavailable(RuntimeError):
    """No search provider configured — caller degrades to a clear result."""


async def _tavily(query: str, k: int, client: httpx.AsyncClient) -> list[SearchHit]:
    resp = await client.post(
        "https://api.tavily.com/search",
        json={"api_key": settings.tavily_api_key, "query": query, "max_results": k},
    )
    resp.raise_for_status()
    out = []
    for r in (resp.json().get("results") or [])[:k]:
        out.append(
            SearchHit(
                title=str(r.get("title") or ""),
                url=str(r.get("url") or ""),
                snippet=str(r.get("content") or "")[:_SNIPPET_CAP],
            )
        )
    return out


async def _brave(query: str, k: int, client: httpx.AsyncClient) -> list[SearchHit]:
    resp = await client.get(
        "https://api.search.brave.com/res/v1/web/search",
        params={"q": query, "count": k},
        headers={"X-Subscription-Token": settings.brave_api_key or "", "Accept": "application/json"},
    )
    resp.raise_for_status()
    results = ((resp.json().get("web") or {}).get("results") or [])[:k]
    return [
        SearchHit(
            title=str(r.get("title") or ""),
            url=str(r.get("url") or ""),
            snippet=str(r.get("description") or "")[:_SNIPPET_CAP],
        )
        for r in results
    ]


async def _searxng(query: str, k: int, client: httpx.AsyncClient) -> list[SearchHit]:
    base = (settings.searxng_url or "").rstrip("/")
    resp = await client.get(f"{base}/search", params={"q": query, "format": "json"})
    resp.raise_for_status()
    return [
        SearchHit(
            title=str(r.get("title") or ""),
            url=str(r.get("url") or ""),
            snippet=str(r.get("content") or "")[:_SNIPPET_CAP],
        )
        for r in (resp.json().get("results") or [])[:k]
    ]


def select_search_provider() -> str | None:
    """The active search provider, or None if unconfigured. Explicit pin wins;
    otherwise auto-select from whichever key/url is present (never fabricates)."""
    pinned = (settings.web_search_provider or "").strip().lower()
    if pinned:
        if pinned == "tavily" and settings.tavily_api_key:
            return "tavily"
        if pinned == "brave" and settings.brave_api_key:
            return "brave"
        if pinned == "searxng" and settings.searxng_url:
            return "searxng"
        return None
    if settings.tavily_api_key:
        return "tavily"
    if settings.brave_api_key:
        return "brave"
    if settings.searxng_url:
        return "searxng"
    return None


class WebSearchTool(Tool):
    """Search the web through the server-configured provider (env-selected).

    One interface over Tavily / Brave / SearXNG. Unconfigured → a clear
    "search not configured" result; never invents results.
    """

    name = "web_search"
    description = (
        "Search the web for a query and return a ranked list of results (title, "
        "URL, snippet). Use to discover pages, then web_fetch to read one."
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The search query."},
        },
        "required": ["query"],
    }

    _BACKENDS = {"tavily": _tavily, "brave": _brave, "searxng": _searxng}

    def __init__(self, client: httpx.AsyncClient | None = None, sink: list | None = None):
        self._client = client
        self._sink = sink

    async def run(self, args: dict, tenant: TenantCtx) -> ToolResult:
        query = (args.get("query") or "").strip()
        if not query:
            return ToolResult(
                prompt_safe("no query provided", source="web_search"), is_error=True
            )
        provider = select_search_provider()
        if provider is None:
            return ToolResult(
                prompt_safe(
                    "web search is not configured on this server (no search "
                    "provider key set); no results were retrieved",
                    source="web_search",
                ),
            )
        client = self._client or httpx.AsyncClient(timeout=_SEARCH_TIMEOUT_S)
        try:
            hits = await self._BACKENDS[provider](query, _MAX_RESULTS, client)
        except Exception as exc:  # provider error → clean degrade, no fabrication
            log.warning("web_search degraded (%s): %s", provider, type(exc).__name__)
            return ToolResult(
                prompt_safe(
                    f"web search unavailable (the {provider} provider returned an "
                    "error); no results were retrieved",
                    source="web_search",
                ),
            )
        if not hits:
            return ToolResult(
                prompt_safe(f"no results for {query!r}", source="web_search")
            )
        if self._sink is not None:
            for h in hits:
                if h.url:
                    self._sink.append({"url": h.url, "title": h.title})
        lines = [f"Search results for: {query}", ""]
        for i, h in enumerate(hits, 1):
            lines.append(f"{i}. {h.title}\n   {h.url}\n   {h.snippet}")
        return ToolResult(prompt_safe("\n".join(lines), source=f"web_search:{provider}"))
