"""MCP tool adapter — one consented MCP tool becomes one callable tool.

Consent is enforced at BUILD time: only tools with an existing per-tool grant
are adapted (see ``build.mcp_consented_tools``), so an unconsented tool is never
advertised. Should one ever be dispatched anyway it fails closed — the registry
rejects unknown names, and the underlying MCP client refuses without consent.

The tool result is external, untrusted content: fetched raw, then run through
the registry's ``prompt_safe`` choke point (BOP-sanitize + wrapUntrusted) before
it re-enters the model context. The user-supplied MCP base_url keeps its SSRF
guard inside the client.
"""

from __future__ import annotations

from app.mcp_client import MCPClient, MCPTool
from app.tenant import TenantCtx
from app.tools.base import Tool, ToolResult, prompt_safe, safe_name


class MCPToolAdapter(Tool):
    def __init__(
        self,
        server_id: str,
        server_name: str,
        base_url: str,
        mcp_tool: MCPTool,
        *,
        client: MCPClient | None = None,
    ):
        self._server_id = server_id
        self._base_url = base_url
        self._real_name = mcp_tool.name
        self._client = client  # injectable for tests; else built per call
        self.name = safe_name("mcp", server_name, mcp_tool.name)
        self.description = mcp_tool.description or f"MCP tool {mcp_tool.name!r}"
        schema = mcp_tool.input_schema or {}
        self.parameters = schema if schema.get("type") == "object" else {
            "type": "object",
            "properties": {},
        }

    async def run(self, args: dict, tenant: TenantCtx) -> ToolResult:
        client = self._client or MCPClient(self._base_url)
        # consent=True: the build step already verified a grant exists for this
        # (user, server, tool); the client still SSRF-guards the URL.
        raw = await client.call_tool_raw(self._real_name, args, consent=True)
        return ToolResult(
            content=prompt_safe(raw, source=f"mcp:{self._real_name}"),
            is_error=False,
        )
