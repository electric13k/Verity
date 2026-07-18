"""Provider abstraction. Every model provider streams the same event shapes;
orchestration upstream never knows which vendor is underneath.

Secrets: API keys are passed in explicitly per call site (env or vault) —
providers never read env themselves and never log keys.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass(frozen=True)
class Delta:
    text: str


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0


StreamEvent = Delta | Usage


@dataclass(frozen=True)
class ChatMessage:
    role: str  # system | user | assistant
    content: str


class ProviderError(RuntimeError):
    pass


class Provider(ABC):
    name: str = "base"

    @abstractmethod
    def stream_chat(
        self, messages: list[ChatMessage], model: str
    ) -> AsyncIterator[StreamEvent]:
        """Yield Delta events followed by a final Usage event."""
