"""Minimal MCP client (streamable HTTP / JSON-RPC 2.0): initialize,
tools/list, tools/call. Enough for users to connect HTTP MCP servers and
surface their tools in chat/flow; stdio transport ships with the desktop
app (M8).

Consent: every call requires an explicit consent flag from the calling
surface — per-tool consent UI lands at M4/M5 frontend; the brain refuses
without it. Tool results are external content: wrapped before prompts.
"""

import itertools
from dataclasses import dataclass

import httpx

from app.wrap import wrap_untrusted

PROTOCOL_VERSION = "2025-03-26"


class MCPError(RuntimeError):
    pass


class ConsentRequired(MCPError):
    pass


@dataclass(frozen=True)
class MCPTool:
    name: str
    description: str
    input_schema: dict


class MCPClient:
    def __init__(self, base_url: str, client: httpx.AsyncClient | None = None):
        self._url = base_url
        self._client = client or httpx.AsyncClient(timeout=30)
        self._ids = itertools.count(1)
        self._initialized = False

    async def _rpc(self, method: str, params: dict | None = None) -> dict:
        resp = await self._client.post(
            self._url,
            json={
                "jsonrpc": "2.0",
                "id": next(self._ids),
                "method": method,
                "params": params or {},
            },
            headers={"accept": "application/json"},
        )
        if resp.status_code != 200:
            raise MCPError(f"mcp server status {resp.status_code}")
        payload = resp.json()
        if "error" in payload:
            raise MCPError(str(payload["error"].get("message", "mcp error")))
        return payload.get("result", {})

    async def initialize(self) -> dict:
        result = await self._rpc(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "verity-brain", "version": "0.1.0"},
            },
        )
        self._initialized = True
        return result

    async def list_tools(self) -> list[MCPTool]:
        if not self._initialized:
            await self.initialize()
        result = await self._rpc("tools/list")
        return [
            MCPTool(
                name=t.get("name", ""),
                description=t.get("description", ""),
                input_schema=t.get("inputSchema", {}),
            )
            for t in result.get("tools", [])
        ]

    async def call_tool(self, name: str, arguments: dict, *, consent: bool) -> str:
        """Returns prompt-safe (wrapped) tool output. Refuses without
        explicit consent — fail closed."""
        if not consent:
            raise ConsentRequired(f"user consent required for tool {name!r}")
        if not self._initialized:
            await self.initialize()
        result = await self._rpc("tools/call", {"name": name, "arguments": arguments})
        parts = [
            c.get("text", "")
            for c in result.get("content", [])
            if c.get("type") == "text"
        ]
        return wrap_untrusted("\n".join(parts), source=f"mcp:{name}")
