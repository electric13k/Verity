"""Branches repo. Records a chat message branching into a Flow/Office run,
carrying conversation context as the run brief (plan §3). Filters by user_id."""

from __future__ import annotations

import json

from app.db import db, ensure_user


async def create(
    user_id: str, chat_msg_id: str, run_kind: str, run_id: str
) -> str:
    """Record a branch. run_id is the id of the flow_runs/offices row created
    for this branch. Returns the branch id."""
    pool = db.require()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await ensure_user(conn, user_id)
            r = await conn.fetchrow(
                "insert into branches (chat_msg_id, user_id, run_kind, run_id) "
                "values ($1, $2, $3, $4) returning id",
                chat_msg_id, user_id, run_kind, run_id,
            )
    return str(r["id"])


async def create_flow_run(user_id: str, definition: dict) -> str:
    """Create a flow_runs row for a branch and return its id."""
    pool = db.require()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await ensure_user(conn, user_id)
            r = await conn.fetchrow(
                "insert into flow_runs (user_id, definition, status) "
                "values ($1, $2, 'running') returning id",
                user_id, json.dumps(definition),
            )
    return str(r["id"])


async def finish_flow_run(user_id: str, run_id: str, status: str, state: dict) -> None:
    """Persist the terminal state of a branch's flow run (background task)."""
    pool = db.require()
    async with pool.acquire() as conn:
        await conn.execute(
            "update flow_runs set status = $3, state = $4, updated_at = now() "
            "where id = $1 and user_id = $2",
            run_id, user_id, status, json.dumps(state),
        )
