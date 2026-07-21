"""ToolRegistry — advertises available tools and dispatches calls, fail-closed.

Only tools placed in the registry are advertised (``specs``) and callable
(``execute``). A name that is not registered — an unconsented MCP tool, a
hallucinated tool — fails closed to an error result rather than executing
anything. Results are returned already prompt-safe.
"""

from __future__ import annotations

import json
import logging

from app.tenant import TenantCtx
from app.tools.base import Tool, ToolResult, prompt_safe, sanitize_machinery
from app.providers.base import ToolSpec

log = logging.getLogger("brain.tools")

_ARG_PREVIEW_CHARS = 120


class ToolRegistry:
    def __init__(self, tools: list[Tool] | None = None):
        self._tools: dict[str, Tool] = {}
        for tool in tools or []:
            # First registration wins; a name collision is a build-time bug but
            # must never let a later tool shadow an earlier one silently.
            self._tools.setdefault(tool.name, tool)

    def __bool__(self) -> bool:
        return bool(self._tools)

    def __len__(self) -> int:
        return len(self._tools)

    def names(self) -> list[str]:
        return list(self._tools)

    def specs(self) -> list[ToolSpec]:
        return [t.spec() for t in self._tools.values()]

    async def execute(self, name: str, args: dict, tenant: TenantCtx) -> ToolResult:
        tool = self._tools.get(name)
        if tool is None:
            # Fail closed: an unadvertised / unconsented tool is never run.
            log.warning(
                "tool call rejected (not available) name=%s user=%s", name, tenant.user_id
            )
            return ToolResult(
                prompt_safe(f"tool {name!r} is not available", source="tool-error"),
                is_error=True,
            )
        if not isinstance(args, dict):
            return ToolResult(
                prompt_safe("tool arguments must be a JSON object", source="tool-error"),
                is_error=True,
            )
        try:
            return await tool.run(args, tenant)
        except Exception as exc:  # a broken tool must never break the chat loop
            log.warning("tool %s failed for user=%s: %s", name, tenant.user_id, exc)
            return ToolResult(
                prompt_safe(f"tool {name!r} error: {exc}", source="tool-error"),
                is_error=True,
            )


def activity_summary(name: str, args: dict) -> str:
    """A BOP-sanitized, length-capped summary of a tool call for the client
    activity stream. Task substance (which tool, a hint of its arguments) is
    preserved; orchestration machinery is redacted. The raw tool RESULT is never
    surfaced here — only that a call is happening."""
    try:
        preview = json.dumps(args, ensure_ascii=False)
    except (TypeError, ValueError):
        preview = str(args)
    if len(preview) > _ARG_PREVIEW_CHARS:
        preview = preview[:_ARG_PREVIEW_CHARS] + "…"
    return sanitize_machinery(f"{name}({preview})")
