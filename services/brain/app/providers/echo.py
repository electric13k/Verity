"""Dev provider: streams the last user message back word by word.

Exists so the whole pipeline (gateway SSE → brain → provider stream →
confidence → learning loop) is exercisable end to end with zero keys.
Only offered when VERITY_DEV_MODE=1 or explicitly requested as "echo:*".
"""

from collections.abc import AsyncIterator

from app.providers.base import (
    ChatMessage,
    Delta,
    Provider,
    StreamEvent,
    ToolSpec,
    Usage,
)


class EchoProvider(Provider):
    name = "echo"
    supports_tools = False  # dev provider stays text-only; tools are ignored

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        model: str,
        tools: list[ToolSpec] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        last_user = next(
            (m.content for m in reversed(messages) if m.role == "user"), ""
        )
        words = last_user.split()
        for i, word in enumerate(words):
            yield Delta(text=word + ("" if i == len(words) - 1 else " "))
        yield Usage(
            input_tokens=sum(len(m.content.split()) for m in messages),
            output_tokens=len(words),
        )
