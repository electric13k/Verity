"""Files repo. Stores markitdown output for uploaded documents; referenced
from chat as files:[{file_id}]. All queries filter by user_id (tenant law)."""

from __future__ import annotations

from dataclasses import dataclass

from app.db import db, ensure_user


@dataclass(frozen=True)
class FileRow:
    id: str
    name: str
    content_type: str
    markdown: str
    byte_size: int


def _row(r) -> FileRow:
    return FileRow(
        id=str(r["id"]),
        name=r["name"],
        content_type=r["content_type"] or "",
        markdown=r["markdown"] or "",
        byte_size=r["byte_size"],
    )


async def create(
    user_id: str, name: str, content_type: str, markdown: str
) -> FileRow:
    pool = db.require()
    byte_size = len(markdown.encode())
    async with pool.acquire() as conn:
        async with conn.transaction():
            await ensure_user(conn, user_id)
            r = await conn.fetchrow(
                "insert into files (user_id, name, content_type, markdown, byte_size) "
                "values ($1, $2, $3, $4, $5) "
                "returning id, name, content_type, markdown, byte_size",
                user_id, name, content_type or None, markdown, byte_size,
            )
    return _row(r)


async def get_many(user_id: str, file_ids: list[str]) -> list[FileRow]:
    if not file_ids:
        return []
    pool = db.require()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "select id, name, content_type, markdown, byte_size from files "
            "where user_id = $1 and id = any($2::uuid[])",
            user_id, file_ids,
        )
    return [_row(r) for r in rows]
