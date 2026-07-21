"""G2 web tools: web_fetch calls the G11 fetch-service contract and degrades
when it is unreachable; web_search degrades unkeyed (never fabricates) and works
through a configured provider. All results ride the wrapUntrusted choke point.
"""

import json

import httpx
import pytest

from app.config import settings
from app.tenant import TenantCtx
from app.tools.web import WebFetchTool, WebSearchTool, select_search_provider

TENANT = TenantCtx(user_id="user_a")


# --- web_fetch -----------------------------------------------------------


async def test_web_fetch_calls_fetch_service_contract(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "final_url": "https://example.com/final",
                "title": "Example",
                "markdown": "# Example\n\nbody text",
                "truncated": False,
            },
        )

    monkeypatch.setattr(settings, "fetch_service_url", "http://fetch:8400")
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    tool = WebFetchTool(client=client)
    result = await tool.run({"url": "https://example.com"}, TENANT)

    # Right contract: POST {FETCH_SERVICE_URL}/fetch with {url, mode, timeout_ms, max_bytes}.
    assert seen["url"] == "http://fetch:8400/fetch"
    assert seen["body"]["url"] == "https://example.com"
    assert set(seen["body"]) == {"url", "mode", "timeout_ms", "max_bytes"}
    # Result is wrapped-untrusted data and carries the page content.
    assert not result.is_error
    assert result.content.startswith("<untrusted_external_data>")
    assert "example.com/final" in result.content and "body text" in result.content


async def test_web_fetch_degrades_when_service_unreachable(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to fetch service")

    monkeypatch.setattr(settings, "fetch_service_url", "http://fetch:8400")
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    tool = WebFetchTool(client=client)
    result = await tool.run({"url": "https://example.com"}, TENANT)

    # Clean degrade, not a crash: a wrapped "unavailable" result, no exception.
    assert not result.is_error
    assert "web fetch unavailable" in result.content
    assert result.content.startswith("<untrusted_external_data>")


async def test_web_fetch_rejects_empty_url():
    result = await WebFetchTool().run({"url": "  "}, TENANT)
    assert result.is_error and "no url" in result.content


# --- web_search ----------------------------------------------------------


async def test_web_search_degrades_unkeyed(monkeypatch):
    monkeypatch.setattr(settings, "web_search_provider", None)
    monkeypatch.setattr(settings, "tavily_api_key", None)
    monkeypatch.setattr(settings, "brave_api_key", None)
    monkeypatch.setattr(settings, "searxng_url", None)
    assert select_search_provider() is None

    result = await WebSearchTool().run({"query": "anything"}, TENANT)
    # Clear "not configured" result — no fabricated hits.
    assert not result.is_error
    assert "not configured" in result.content
    assert "http" not in result.content.split("not configured")[1]


async def test_web_search_uses_configured_provider(monkeypatch):
    monkeypatch.setattr(settings, "web_search_provider", None)
    monkeypatch.setattr(settings, "tavily_api_key", "secret-key")
    monkeypatch.setattr(settings, "brave_api_key", None)
    monkeypatch.setattr(settings, "searxng_url", None)
    assert select_search_provider() == "tavily"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "results": [
                    {"title": "Result One", "url": "https://a.test/1", "content": "snip one"},
                    {"title": "Result Two", "url": "https://b.test/2", "content": "snip two"},
                ]
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await WebSearchTool(client=client).run({"query": "topic"}, TENANT)
    assert not result.is_error
    assert "Result One" in result.content and "https://a.test/1" in result.content
    assert result.content.startswith("<untrusted_external_data>")


async def test_web_search_records_sources_to_sink(monkeypatch):
    monkeypatch.setattr(settings, "web_search_provider", "tavily")
    monkeypatch.setattr(settings, "tavily_api_key", "k")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"results": [{"title": "T", "url": "https://s.test/x", "content": "c"}]}
        )

    sink: list = []
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    await WebSearchTool(client=client, sink=sink).run({"query": "q"}, TENANT)
    assert sink == [{"url": "https://s.test/x", "title": "T"}]
