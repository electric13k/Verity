"""Messages repo. All queries filter by user_id (tenant law). Messages are
always addressed by (id, user_id) so a message id from another tenant resolves
to nothing (fail closed)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.db import db, ensure_user

HISTORY_WINDOW = 20


@dataclass(frozen=True)
class MessageRow:
    id: str
    conversation_id: str
    role: str
    content: str
    model: str
    confidence: int | None
    created_at: datetime


def _row(r) -> MessageRow:
    return MessageRow(
        id=str(r["id"]),
        conversation_id=str(r["conversation_id"]),
        role=r["role"],
        content=r["content"],
        model=r["model"] or "",
        confidence=r["confidence"],
        created_at=r["created_at"],
    )


async def add(
    user_id: str,
    conversation_id: str,
    role: str,
    content: str,
    model: str = "",
    confidence: int | None = None,
) -> MessageRow:
    pool = db.require()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await ensure_user(conn, user_id)
            r = await conn.fetchrow(
                "insert into messages (conversation_id, user_id, role, content, model, confidence) "
                "values ($1, $2, $3, $4, $5, $6) "
                "returning id, conversation_id, role, content, model, confidence, created_at",
                conversation_id, user_id, role, content, model or None, confidence,
            )
    return _row(r)


async def get(user_id: str, message_id: str) -> MessageRow | None:
    pool = db.require()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "select id, conversation_id, role, content, model, confidence, created_at "
            "from messages where id = $1 and user_id = $2",
            message_id, user_id,
        )
    return _row(r) if r else None


async def history(
    user_id: str, conversation_id: str, limit: int = HISTORY_WINDOW
) -> list[MessageRow]:
    """The last ``limit`` messages of a conversation, chronological order."""
    pool = db.require()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "select id, conversation_id, role, content, model, confidence, created_at "
            "from (select * from messages where conversation_id = $1 and user_id = $2 "
            "      order by created_at desc limit $3) sub "
            "order by created_at asc",
            conversation_id, user_id, limit,
        )
    return [_row(r) for r in rows]


async def all_for_conversation(user_id: str, conversation_id: str) -> list[MessageRow]:
    pool = db.require()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "select id, conversation_id, role, content, model, confidence, created_at "
            "from messages where conversation_id = $1 and user_id = $2 "
            "order by created_at asc",
            conversation_id, user_id,
        )
    return [_row(r) for r in rows]


async def update_content(
    user_id: str, message_id: str, content: str, confidence: int | None = None
) -> None:
    pool = db.require()
    async with pool.acquire() as conn:
        await conn.execute(
            "update messages set content = $3, confidence = coalesce($4, confidence) "
            "where id = $1 and user_id = $2",
            message_id, user_id, content, confidence,
        )


async def truncate_after(
    user_id: str, conversation_id: str, created_at: datetime, inclusive: bool = False
) -> None:
    """Delete every message after (or at, if inclusive) a timestamp. Used by
    regenerate (inclusive: drop this assistant turn onward) and edit (drop
    everything below the edited message)."""
    pool = db.require()
    op = ">=" if inclusive else ">"
    async with pool.acquire() as conn:
        await conn.execute(
            f"delete from messages where conversation_id = $1 and user_id = $2 "
            f"and created_at {op} $3",
            conversation_id, user_id, created_at,
        )
