"""Provider abstraction. Every model provider streams the same event shapes;
orchestration upstream never knows which vendor is underneath.

Two streaming shapes now cross this boundary:
  * text — ``Delta`` chunks followed by a final ``Usage`` (unchanged contract);
  * tool use — a provider may also emit ``ToolCall`` events when the model wants
    to invoke an advertised tool. The orchestration loop executes the tool and
    feeds the result back on the next turn as a role="tool" ``ChatMessage``.

Providers that cannot do tool use (echo-dev, any text-only backend) simply
ignore the ``tools`` argument and never emit ``ToolCall`` — the text contract is
untouched, so every existing call site keeps working.

Secrets: API keys are passed in explicitly per call site (env or vault) —
providers never read env themselves and never log keys.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Delta:
    text: str


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass(frozen=True)
class ToolCall:
    """A model's request to invoke a tool. ``arguments`` is the parsed JSON
    object the model produced (the canonical form); providers re-serialize it to
    their own wire shape when the assistant turn is replayed. ``id`` correlates a
    call with its result across turns."""

    id: str
    name: str
    arguments: dict = field(default_factory=dict)


StreamEvent = Delta | Usage | ToolCall


@dataclass(frozen=True)
class ToolSpec:
    """A tool advertised to the model: name + JSON-Schema for its arguments.
    Vendor-neutral; each provider maps it to its own tool/function shape."""

    name: str
    description: str
    parameters: dict = field(default_factory=lambda: {"type": "object", "properties": {}})


@dataclass(frozen=True)
class ChatMessage:
    """A conversation turn.

    Text turns use (role, content) as before. Two agentic turn kinds extend it,
    both carrying zero new required fields so existing positional construction is
    unchanged:
      * an assistant turn that requested tools sets ``tool_calls``;
      * a tool-result turn uses role="tool" with ``tool_call_id`` + ``name`` and
        ``content`` = the (already wrapped-untrusted, prompt-safe) result.
    """

    role: str  # system | user | assistant | tool
    content: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    tool_call_id: str = ""
    name: str = ""
    is_error: bool = False  # tool-result turns: the tool failed


class ProviderError(RuntimeError):
    pass


class Provider(ABC):
    name: str = "base"
    # Whether stream_chat honours the ``tools`` argument and can emit ToolCall.
    # Tool-less providers leave this False and degrade to plain text.
    supports_tools: bool = False

    @abstractmethod
    def stream_chat(
        self,
        messages: list[ChatMessage],
        model: str,
        tools: list[ToolSpec] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Yield Delta events (and, for tool-capable providers, ToolCall events)
        followed by a final Usage event. ``tools`` is advisory: a provider that
        does not support tool use ignores it and streams text only."""
