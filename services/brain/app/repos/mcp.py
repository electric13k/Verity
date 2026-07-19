"""MCP servers + per-tool consent repo. Consent state lives here: a tools/call
is refused unless a (user_id, server_id, tool) grant exists. All queries filter
by user_id (tenant law)."""

from __future__ import annotations

from dataclasses import dataclass

from app.db import db, ensure_user


@dataclass(frozen=True)
class McpServerRow:
    id: str
    name: str
    base_url: str


def _row(r) -> McpServerRow:
    return McpServerRow(id=str(r["id"]), name=r["name"], base_url=r["base_url"])


async def create(user_id: str, name: str, base_url: str) -> McpServerRow:
    pool = db.require()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await ensure_user(conn, user_id)
            r = await conn.fetchrow(
                "insert into mcp_servers (user_id, name, base_url) values ($1, $2, $3) "
                "on conflict (user_id, name) do update set base_url = excluded.base_url "
                "returning id, name, base_url",
                user_id, name, base_url,
            )
    return _row(r)


async def get(user_id: str, server_id: str) -> McpServerRow | None:
    pool = db.require()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "select id, name, base_url from mcp_servers where id = $1 and user_id = $2",
            server_id, user_id,
        )
    return _row(r) if r else None


async def list_all(user_id: str) -> list[McpServerRow]:
    pool = db.require()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "select id, name, base_url from mcp_servers where user_id = $1 order by name",
            user_id,
        )
    return [_row(r) for r in rows]


async def grant_consent(user_id: str, server_id: str, tool: str) -> None:
    pool = db.require()
    async with pool.acquire() as conn:
        await conn.execute(
            "insert into mcp_consent (user_id, server_id, tool) values ($1, $2, $3) "
            "on conflict (user_id, server_id, tool) do nothing",
            user_id, server_id, tool,
        )


async def has_consent(user_id: str, server_id: str, tool: str) -> bool:
    pool = db.require()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "select 1 from mcp_consent where user_id = $1 and server_id = $2 and tool = $3",
            user_id, server_id, tool,
        )
    return r is not None
