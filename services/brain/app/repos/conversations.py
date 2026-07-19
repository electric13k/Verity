"""Conversations repo. All queries filter by user_id (tenant law)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.db import db, ensure_user

PAGE_SIZE = 30


@dataclass(frozen=True)
class ConversationRow:
    id: str
    title: str
    created_at: datetime
    updated_at: datetime


def _row(r) -> ConversationRow:
    return ConversationRow(
        id=str(r["id"]),
        title=r["title"] or "",
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


async def create(user_id: str, title: str | None = None) -> ConversationRow:
    pool = db.require()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await ensure_user(conn, user_id)
            r = await conn.fetchrow(
                "insert into conversations (user_id, title) values ($1, $2) "
                "returning id, title, created_at, updated_at",
                user_id, title,
            )
    return _row(r)


async def get(user_id: str, conversation_id: str) -> ConversationRow | None:
    pool = db.require()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "select id, title, created_at, updated_at from conversations "
            "where id = $1 and user_id = $2",
            conversation_id, user_id,
        )
    return _row(r) if r else None


async def list_page(
    user_id: str, cursor: str | None = None, limit: int = PAGE_SIZE
) -> tuple[list[ConversationRow], str | None]:
    """Returns (items, next_cursor). Cursor is the updated_at of the last item."""
    pool = db.require()
    cursor_ts: datetime | None = None
    if cursor:
        try:
            cursor_ts = datetime.fromisoformat(cursor)
        except ValueError:
            cursor_ts = None
    async with pool.acquire() as conn:
        if cursor_ts is not None:
            rows = await conn.fetch(
                "select id, title, created_at, updated_at from conversations "
                "where user_id = $1 and updated_at < $2 "
                "order by updated_at desc limit $3",
                user_id, cursor_ts, limit + 1,
            )
        else:
            rows = await conn.fetch(
                "select id, title, created_at, updated_at from conversations "
                "where user_id = $1 order by updated_at desc limit $2",
                user_id, limit + 1,
            )
    items = [_row(r) for r in rows[:limit]]
    next_cursor = (
        items[-1].updated_at.isoformat() if len(rows) > limit and items else None
    )
    return items, next_cursor


async def rename(user_id: str, conversation_id: str, title: str) -> ConversationRow | None:
    pool = db.require()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "update conversations set title = $3, updated_at = now() "
            "where id = $1 and user_id = $2 "
            "returning id, title, created_at, updated_at",
            conversation_id, user_id, title,
        )
    return _row(r) if r else None


async def set_title_if_absent(user_id: str, conversation_id: str, title: str) -> None:
    """Auto-name: set the title only when it is still empty/null."""
    pool = db.require()
    async with pool.acquire() as conn:
        await conn.execute(
            "update conversations set title = $3 "
            "where id = $1 and user_id = $2 and (title is null or title = '')",
            conversation_id, user_id, title,
        )


async def touch(user_id: str, conversation_id: str) -> None:
    pool = db.require()
    async with pool.acquire() as conn:
        await conn.execute(
            "update conversations set updated_at = now() "
            "where id = $1 and user_id = $2",
            conversation_id, user_id,
        )


async def delete(user_id: str, conversation_id: str) -> bool:
    pool = db.require()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "delete from conversations where id = $1 and user_id = $2",
            conversation_id, user_id,
        )
    return result.endswith("1")
