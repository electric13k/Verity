"""Tool interface + the untrusted-output choke point.

A Tool exposes a name, a JSON-Schema for its arguments, and an async ``run``
that returns a ToolResult whose ``content`` is already prompt-safe. Adapters
build ``content`` through :func:`prompt_safe`, which is the ONE place external
tool output is BOP-sanitized and wrapUntrusted-wrapped before it can enter a
prompt. Tenant identity is passed in explicitly (from gRPC metadata) — a tool
never reads it from anywhere else.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.bop import sanitize_machinery
from app.providers.base import ToolSpec
from app.tenant import TenantCtx
from app.wrap import wrap_untrusted

# Tool names must satisfy both Anthropic and OpenAI (^[a-zA-Z0-9_-]{1,64}$).
_NAME_SAFE = re.compile(r"[^a-zA-Z0-9_-]")


def safe_name(*parts: str) -> str:
    joined = "__".join(p for p in parts if p)
    cleaned = _NAME_SAFE.sub("_", joined).strip("_") or "tool"
    return cleaned[:64]


def prompt_safe(raw: str, source: str) -> str:
    """Make raw external tool output safe to re-enter a prompt: BOP-sanitize any
    machinery, then wrap as untrusted data. The wrap neutralizes embedded
    closing tags, so the result cannot break the envelope or forge a tool call —
    it is inert data the model may read but not obey."""
    return wrap_untrusted(sanitize_machinery(raw), source=source)


@dataclass(frozen=True)
class ToolResult:
    content: str  # prompt-safe: BOP-sanitized + wrapUntrusted-wrapped
    is_error: bool = False


class Tool(ABC):
    name: str = "tool"
    description: str = ""
    parameters: dict = {"type": "object", "properties": {}}

    def spec(self) -> ToolSpec:
        return ToolSpec(
            name=self.name,
            description=self.description,
            parameters=self.parameters or {"type": "object", "properties": {}},
        )

    @abstractmethod
    async def run(self, args: dict, tenant: TenantCtx) -> ToolResult:
        """Execute with the model-supplied ``args`` on behalf of ``tenant``.
        Must return a ToolResult with prompt-safe ``content`` (build it via
        :func:`prompt_safe`)."""
