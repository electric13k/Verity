"""Anthropic Messages API, SSE streaming."""

import json
from collections.abc import AsyncIterator

import httpx

from app.providers.base import (
    ChatMessage,
    Delta,
    Provider,
    ProviderError,
    StreamEvent,
    Usage,
)

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"


def parse_sse_line(line: str) -> dict | None:
    """Parse one SSE data line into its JSON payload (None for non-data)."""
    if not line.startswith("data:"):
        return None
    payload = line[len("data:"):].strip()
    if not payload or payload == "[DONE]":
        return None
    return json.loads(payload)


def event_from_payload(payload: dict) -> StreamEvent | None:
    kind = payload.get("type")
    if kind == "content_block_delta":
        delta = payload.get("delta", {})
        if delta.get("type") == "text_delta":
            return Delta(text=delta.get("text", ""))
    elif kind == "message_delta":
        usage = payload.get("usage", {})
        return Usage(output_tokens=usage.get("output_tokens", 0))
    return None


class AnthropicProvider(Provider):
    name = "anthropic"

    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None):
        self._api_key = api_key
        self._client = client or httpx.AsyncClient(timeout=120)

    async def stream_chat(
        self, messages: list[ChatMessage], model: str
    ) -> AsyncIterator[StreamEvent]:
        system = "\n\n".join(m.content for m in messages if m.role == "system")
        body = {
            "model": model,
            "max_tokens": 4096,
            "stream": True,
            "messages": [
                {"role": m.role, "content": m.content}
                for m in messages
                if m.role in ("user", "assistant")
            ],
        }
        if system:
            body["system"] = system
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": API_VERSION,
            "content-type": "application/json",
        }
        input_tokens = 0
        async with self._client.stream("POST", API_URL, json=body, headers=headers) as resp:
            if resp.status_code != 200:
                detail = (await resp.aread()).decode(errors="replace")[:500]
                raise ProviderError(f"anthropic {resp.status_code}: {detail}")
            async for line in resp.aiter_lines():
                payload = parse_sse_line(line)
                if payload is None:
                    continue
                if payload.get("type") == "message_start":
                    input_tokens = (
                        payload.get("message", {}).get("usage", {}).get("input_tokens", 0)
                    )
                    continue
                event = event_from_payload(payload)
                if isinstance(event, Usage):
                    yield Usage(input_tokens=input_tokens, output_tokens=event.output_tokens)
                elif event is not None:
                    yield event
