"""Anthropic Messages API, SSE streaming — text + tool use.

Tool-calling shape (docs.anthropic.com/en/docs/build-with-claude/tool-use):
  * request advertises tools as ``tools: [{name, description, input_schema}]``;
  * the model streams a ``tool_use`` content block — ``content_block_start`` with
    ``{type:"tool_use", id, name}``, then ``input_json_delta`` fragments whose
    ``partial_json`` accumulate into the arguments, then ``content_block_stop``;
    the terminal ``message_delta`` carries ``stop_reason:"tool_use"``;
  * results go back as a user turn of ``tool_result`` blocks
    ``{type:"tool_result", tool_use_id, content, is_error}``.
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


def _parse_args(buf: str) -> dict:
    """Parse accumulated tool-input JSON. An empty buffer means no args; a
    malformed buffer (model produced junk) fails closed to an empty object so the
    tool sees no arguments rather than crashing the stream."""
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
            "name": t.name,
            "description": t.description,
            "input_schema": t.parameters or {"type": "object", "properties": {}},
        }
        for t in tools
    ]


def _to_messages(messages: list[ChatMessage]) -> tuple[str, list[dict]]:
    """Serialize our ChatMessages to (system, anthropic_messages). Assistant
    turns carry text + tool_use blocks; consecutive tool-result turns coalesce
    into a single user message (Anthropic requires tool_result blocks in a user
    turn)."""
    system = "\n\n".join(m.content for m in messages if m.role == "system")
    out: list[dict] = []
    pending_results: list[dict] = []

    def flush_results() -> None:
        if pending_results:
            out.append({"role": "user", "content": list(pending_results)})
            pending_results.clear()

    for m in messages:
        if m.role == "tool":
            pending_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": m.tool_call_id,
                    "content": m.content,
                    "is_error": m.is_error,
                }
            )
            continue
        flush_results()
        if m.role == "assistant" and m.tool_calls:
            blocks: list[dict] = []
            if m.content:
                blocks.append({"type": "text", "text": m.content})
            for tc in m.tool_calls:
                blocks.append(
                    {"type": "tool_use", "id": tc.id, "name": tc.name, "input": tc.arguments}
                )
            out.append({"role": "assistant", "content": blocks})
        elif m.role in ("user", "assistant"):
            out.append({"role": m.role, "content": m.content})
    flush_results()
    return system, out


class AnthropicProvider(Provider):
    name = "anthropic"
    supports_tools = True

    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None):
        self._api_key = api_key
        self._client = client or httpx.AsyncClient(timeout=120)

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        model: str,
        tools: list[ToolSpec] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        system, anthropic_messages = _to_messages(messages)
        body: dict = {
            "model": model,
            "max_tokens": 4096,
            "stream": True,
            "messages": anthropic_messages,
        }
        if system:
            body["system"] = system
        if tools:
            body["tools"] = _tools_param(tools)
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": API_VERSION,
            "content-type": "application/json",
        }
        input_tokens = 0
        # index -> {"kind": "tool_use"|"text", "id", "name", "buf"}
        blocks: dict[int, dict] = {}
        async with self._client.stream("POST", API_URL, json=body, headers=headers) as resp:
            if resp.status_code != 200:
                detail = (await resp.aread()).decode(errors="replace")[:500]
                raise ProviderError(f"anthropic {resp.status_code}: {detail}")
            async for line in resp.aiter_lines():
                payload = parse_sse_line(line)
                if payload is None:
                    continue
                kind = payload.get("type")
                if kind == "message_start":
                    input_tokens = (
                        payload.get("message", {}).get("usage", {}).get("input_tokens", 0)
                    )
                elif kind == "content_block_start":
                    idx = payload.get("index", 0)
                    cb = payload.get("content_block", {})
                    if cb.get("type") == "tool_use":
                        blocks[idx] = {
                            "kind": "tool_use",
                            "id": cb.get("id", ""),
                            "name": cb.get("name", ""),
                            "buf": "",
                        }
                    else:
                        blocks[idx] = {"kind": cb.get("type", "text")}
                elif kind == "content_block_delta":
                    delta = payload.get("delta", {})
                    dtype = delta.get("type")
                    if dtype == "text_delta":
                        yield Delta(text=delta.get("text", ""))
                    elif dtype == "input_json_delta":
                        block = blocks.get(payload.get("index", 0))
                        if block is not None:
                            block["buf"] = block.get("buf", "") + delta.get("partial_json", "")
                elif kind == "content_block_stop":
                    block = blocks.pop(payload.get("index", 0), None)
                    if block is not None and block.get("kind") == "tool_use":
                        yield ToolCall(
                            id=block["id"],
                            name=block["name"],
                            arguments=_parse_args(block.get("buf", "")),
                        )
                elif kind == "message_delta":
                    usage = payload.get("usage", {})
                    yield Usage(
                        input_tokens=input_tokens,
                        output_tokens=usage.get("output_tokens", 0),
                    )
