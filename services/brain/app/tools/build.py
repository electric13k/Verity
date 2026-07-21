"""Per-tenant tool-registry assembly.

Gathers the tools a given tenant may use this turn:
  * skills discovered under ``VERITY_SKILLS_PATH`` (local, cheap);
  * each CONSENTED MCP tool across the tenant's connected servers — discovered
    by listing each server and keeping only tools with an existing consent grant
    (unconsented tools are never offered).

Everything is best-effort and guarded: with no skills path and no MCP servers
(the default), the registry is empty and chat behaves exactly as before —
tools are not advertised and the model runs a single, tool-less turn. Boot and
requests degrade, never die: a failing MCP server drops out silently.
"""

from __future__ import annotations

import logging
import os

from app.db import db
from app.mcp_client import MCPClient
from app.repos import mcp as mcp_repo
from app.skills.loader import load_skills
from app.tenant import TenantCtx
from app.tools.files import file_output_tools
from app.tools.kb_tools import kb_tools
from app.tools.mcp_tools import MCPToolAdapter
from app.tools.registry import ToolRegistry
from app.tools.skill_tools import SkillToolAdapter
from app.tools.web import WebFetchTool, WebSearchTool

log = logging.getLogger("brain.tools")

SKILLS_PATH_ENV = "VERITY_SKILLS_PATH"
# Cap the number of MCP servers we probe per turn so a user with many servers
# cannot make each chat request fan out unboundedly.
_MAX_MCP_SERVERS = 16


def skill_tools() -> list[SkillToolAdapter]:
    root = os.environ.get(SKILLS_PATH_ENV, "")
    if not root:
        return []
    try:
        return [SkillToolAdapter(s) for s in load_skills(root)]
    except Exception as exc:  # a bad skills dir must not break chat
        log.warning("skill discovery failed: %s", exc)
        return []


async def mcp_consented_tools(user_id: str) -> list[MCPToolAdapter]:
    """Consented MCP tools for the user. Lists each server's tools and keeps only
    those with a persisted consent grant. Any server that fails to list is
    skipped."""
    if not db.available or not user_id:
        return []
    try:
        servers = await mcp_repo.list_all(user_id)
    except Exception as exc:
        log.warning("mcp server list failed: %s", exc)
        return []
    out: list[MCPToolAdapter] = []
    for server in servers[:_MAX_MCP_SERVERS]:
        try:
            client = MCPClient(server.base_url)
            tools = await client.list_tools()
        except Exception as exc:  # SSRF guard / unreachable / bad server
            log.warning("mcp list_tools failed for server=%s: %s", server.id, exc)
            continue
        for mcp_tool in tools:
            try:
                granted = await mcp_repo.has_consent(user_id, server.id, mcp_tool.name)
            except Exception:
                granted = False
            if granted:
                out.append(
                    MCPToolAdapter(server.id, server.name, server.base_url, mcp_tool)
                )
    return out


def builtin_tools() -> list:
    """Server-provided tools always advertised to a tool-capable model. Each
    degrades cleanly when unconfigured (web search/fetch, image gen) or when an
    optional lib is absent (file-output) — being unconfigured is a runtime
    degrade, never an absent tool. No consent gate: these call only
    server-configured endpoints (web_fetch → the internal SSRF-guarded fetch
    service; web_search → the one configured provider) or the caller's own
    tenant store (kb/file-output), never a user-supplied host."""
    return [
        WebSearchTool(),
        WebFetchTool(),
        *file_output_tools(),
        *kb_tools(),
    ]


async def build_registry(tenant: TenantCtx) -> ToolRegistry:
    tools: list = list(builtin_tools())
    tools.extend(skill_tools())
    tools.extend(await mcp_consented_tools(tenant.user_id))
    return ToolRegistry(tools)
