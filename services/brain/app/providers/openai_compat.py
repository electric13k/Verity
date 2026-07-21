"""OpenAI-compatible chat completions (OpenAI itself, Ollama /v1, the house
Ollama Cloud endpoint, and Google's Gemini OpenAI-compat endpoint all speak
this), SSE streaming — text + tool/function calling.

Tool-calling shape (platform.openai.com/docs/guides/function-calling):
  * request advertises ``tools: [{type:"function", function:{name, description,
    parameters}}]``;
  * the model streams ``choices[].delta.tool_calls`` fragments — each carries an
    ``index`` plus, spread across chunks, ``id`` and
    ``function.{name, arguments}`` where ``arguments`` is a JSON string
    accumulated by index; the terminal chunk carries ``finish_reason:"tool_calls"``;
  * results go back as ``{role:"tool", tool_call_id, content}`` messages, after
    an assistant message that echoes the ``tool_calls``.
"""

import json
from collections.abc import AsyncIterator

import httpx

from app.providers.base import (
    ChatMessage,
    Delta,
    Provider,
    ProviderError,
    StreamEvent,
    ToolCall,
    ToolSpec,
    Usage,
)


def event_from_chunk(payload: dict) -> StreamEvent | None:
    """Text/usage from a streaming chunk. Tool-call fragments are handled
    statefully in ``stream_chat`` (they span multiple chunks) and are ignored
    here."""
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


def _parse_args(buf: str) -> dict:
    if not buf.strip():
        return {}
    try:
        value = json.loads(buf)
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _tools_param(tools: list[ToolSpec]) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters or {"type": "object", "properties": {}},
            },
        }
        for t in tools
    ]


def _to_messages(messages: list[ChatMessage]) -> list[dict]:
    out: list[dict] = []
    for m in messages:
        if m.role == "tool":
            out.append(
                {"role": "tool", "tool_call_id": m.tool_call_id, "content": m.content}
            )
        elif m.role == "assistant" and m.tool_calls:
            out.append(
                {
                    "role": "assistant",
                    "content": m.content or None,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": json.dumps(tc.arguments),
                            },
                        }
                        for tc in m.tool_calls
                    ],
                }
            )
        else:
            out.append({"role": m.role, "content": m.content})
    return out


class OpenAICompatProvider(Provider):
    supports_tools = True

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
        self,
        messages: list[ChatMessage],
        model: str,
        tools: list[ToolSpec] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        body: dict = {
            "model": model,
            "stream": True,
            "stream_options": {"include_usage": True},
            "messages": _to_messages(messages),
        }
        if tools:
            body["tools"] = _tools_param(tools)
        headers = {"authorization": f"Bearer {self._api_key}"}
        # index -> {"id", "name", "args"}
        tool_accum: dict[int, dict] = {}
        async with self._client.stream(
            "POST", f"{self._base_url}/chat/completions", json=body, headers=headers
        ) as resp:
            if resp.status_code != 200:
                detail = (await resp.aread()).decode(errors="replace")[:500]
                raise ProviderError(f"{self.name} {resp.status_code}: {detail}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[len("data:"):].strip()
                if not raw or raw == "[DONE]":
                    continue
                payload = json.loads(raw)
                event = event_from_chunk(payload)
                if event is not None:
                    yield event
                for choice in payload.get("choices") or []:
                    delta = choice.get("delta") or {}
                    for frag in delta.get("tool_calls") or []:
                        idx = frag.get("index", 0)
                        slot = tool_accum.setdefault(idx, {"id": "", "name": "", "args": ""})
                        if frag.get("id"):
                            slot["id"] = frag["id"]
                        fn = frag.get("function") or {}
                        if fn.get("name"):
                            slot["name"] = fn["name"]
                        if fn.get("arguments"):
                            slot["args"] += fn["arguments"]
                    if choice.get("finish_reason") == "tool_calls" and tool_accum:
                        for idx in sorted(tool_accum):
                            slot = tool_accum[idx]
                            yield ToolCall(
                                id=slot["id"] or f"call_{idx}",
                                name=slot["name"],
                                arguments=_parse_args(slot["args"]),
                            )
                        tool_accum.clear()
