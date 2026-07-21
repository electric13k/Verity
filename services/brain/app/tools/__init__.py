"""Tool registry — the bridge that makes Verity's existing capabilities
(consented MCP tools, sandboxed skills) callable by the model.

Every tool result is EXTERNAL, UNTRUSTED content: it is wrapped (wrapUntrusted)
and BOP-sanitized at a single choke point (``prompt_safe``) before it re-enters
the model context, so a hostile result can neither forge a tool call nor break
the envelope. The model's own sanctioned tool-call channel is the only thing
that can drive the loop.
"""

from app.tools.base import Tool, ToolResult, prompt_safe
from app.tools.registry import ToolRegistry, activity_summary
from app.tools.build import build_registry

__all__ = [
    "Tool",
    "ToolResult",
    "ToolRegistry",
    "prompt_safe",
    "activity_summary",
    "build_registry",
]
