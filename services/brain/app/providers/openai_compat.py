"""OpenAI-compatible chat completions (OpenAI itself, Ollama /v1, and the
house Ollama Cloud endpoint all speak this), SSE streaming."""

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


def event_from_chunk(payload: dict) -> StreamEvent | None:
    if payload.get("usage"):
        u = payload["usage"]
        return Usage(
            input_tokens=u.get("prompt_tokens", 0),
            output_tokens=u.get("completion_tokens", 0),
        )
    choices = payload.get("choices") or []
    if choices:
        content = (choices[0].get("delta") or {}).get("content")
        if content:
            return Delta(text=content)
    return None


class OpenAICompatProvider(Provider):
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        name: str = "openai",
        client: httpx.AsyncClient | None = None,
    ):
        self.name = name
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.AsyncClient(timeout=120)

    async def stream_chat(
        self, messages: list[ChatMessage], model: str
    ) -> AsyncIterator[StreamEvent]:
        body = {
            "model": model,
            "stream": True,
            "stream_options": {"include_usage": True},
            "messages": [{"role": m.role, "content": m.content} for m in messages],
        }
        headers = {"authorization": f"Bearer {self._api_key}"}
        async with self._client.stream(
            "POST", f"{self._base_url}/chat/completions", json=body, headers=headers
        ) as resp:
            if resp.status_code != 200:
                detail = (await resp.aread()).decode(errors="replace")[:500]
                raise ProviderError(f"{self.name} {resp.status_code}: {detail}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if not payload or payload == "[DONE]":
                    continue
                event = event_from_chunk(json.loads(payload))
                if event is not None:
                    yield event
