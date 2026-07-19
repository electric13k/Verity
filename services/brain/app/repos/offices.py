"""Offices repo. Office definition is stored as jsonb; per-run STATE.md
checkpoints land in office_runs.state_md. All queries filter by user_id."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from app.db import db, ensure_user


@dataclass(frozen=True)
class OfficeRow:
    id: str
    name: str
    schedule_cron: str
    definition: dict
    enabled: bool


@dataclass(frozen=True)
class OfficeRunRow:
    id: str
    office_id: str
    status: str
    state_md: str
    started_at: datetime | None
    finished_at: datetime | None


def _office(r) -> OfficeRow:
    return OfficeRow(
        id=str(r["id"]),
        name=r["name"],
        schedule_cron=r["schedule_cron"] or "",
        definition=r["definition"] if isinstance(r["definition"], dict) else json.loads(r["definition"]),
        enabled=r["enabled"],
    )


def _run(r) -> OfficeRunRow:
    return OfficeRunRow(
        id=str(r["id"]),
        office_id=str(r["office_id"]),
        status=r["status"],
        state_md=r["state_md"] or "",
        started_at=r["started_at"],
        finished_at=r["finished_at"],
    )


async def create(
    user_id: str, name: str, schedule_cron: str, definition: dict
) -> OfficeRow:
    pool = db.require()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await ensure_user(conn, user_id)
            r = await conn.fetchrow(
                "insert into offices (user_id, name, schedule_cron, definition) "
                "values ($1, $2, $3, $4) "
                "returning id, name, schedule_cron, definition, enabled",
                user_id, name, schedule_cron or None, json.dumps(definition),
            )
    return _office(r)


async def get(user_id: str, office_id: str) -> OfficeRow | None:
    pool = db.require()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "select id, name, schedule_cron, definition, enabled from offices "
            "where id = $1 and user_id = $2",
            office_id, user_id,
        )
    return _office(r) if r else None


async def list_all(user_id: str) -> list[OfficeRow]:
    pool = db.require()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "select id, name, schedule_cron, definition, enabled from offices "
            "where user_id = $1 order by created_at desc",
            user_id,
        )
    return [_office(r) for r in rows]


async def start_run(user_id: str, office_id: str) -> str:
    pool = db.require()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "insert into office_runs (office_id, user_id, status, started_at) "
            "values ($1, $2, 'running', now()) returning id",
            office_id, user_id,
        )
    return str(r["id"])


async def finish_run(
    user_id: str, run_id: str, status: str, state_md: str
) -> None:
    pool = db.require()
    async with pool.acquire() as conn:
        await conn.execute(
            "update office_runs set status = $3, state_md = $4, finished_at = now() "
            "where id = $1 and user_id = $2",
            run_id, user_id, status, state_md,
        )


async def get_run(user_id: str, office_id: str, run_id: str) -> OfficeRunRow | None:
    pool = db.require()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "select id, office_id, status, state_md, started_at, finished_at "
            "from office_runs where id = $1 and user_id = $2 and office_id = $3",
            run_id, user_id, office_id,
        )
    return _run(r) if r else None
