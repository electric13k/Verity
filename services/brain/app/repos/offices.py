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


@dataclass(frozen=True)
class DueOffice:
    """A row returned by the G3 scheduler's cross-tenant scan. Carries the
    OWNER user_id so every follow-up write/run re-binds to that tenant."""

    id: str
    user_id: str
    schedule_cron: str
    next_fire_at: datetime | None


def _office(r) -> OfficeRow:
    return OfficeRow(
        id=str(r["id"]),
        name=r["name"],
        schedule_cron=r["schedule_cron"] or "",
        definition=r["definition"] if isinstance(r["definition"], dict) else json.loads(r["definition"]),
        enabled=r["enabled"],
    )


def _due(r) -> DueOffice:
    return DueOffice(
        id=str(r["id"]),
        user_id=str(r["user_id"]),
        schedule_cron=r["schedule_cron"] or "",
        next_fire_at=r["next_fire_at"],
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


# --- G3 scheduler bookkeeping (0004_office_scheduler.sql) ------------------
#
# The three functions below are the durable exactly-once-per-window machinery
# the cron ticker drives. Only due_for_scheduling reads across tenants (the one
# sanctioned scheduler read); it returns each row's OWNER user_id and every
# follow-up (seed_next_fire / claim_fire / start_run) re-binds to that owner.


async def due_for_scheduling(now: datetime, *, limit: int = 500) -> list[DueOffice]:
    """SCHEDULER-ONLY cross-tenant scan. Enabled, scheduled offices whose next
    window is due (next_fire_at <= now) OR not yet seeded (NULL). Not reachable
    from any request path — the ticker calls it server-side; each row carries
    its owner user_id, re-bound on every subsequent write."""
    pool = db.require()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "select id, user_id, schedule_cron, next_fire_at from offices "
            "where enabled and schedule_cron is not null "
            "and (next_fire_at is null or next_fire_at <= $1) "
            "order by next_fire_at asc nulls first "
            "limit $2",
            now, limit,
        )
    return [_due(r) for r in rows]


async def seed_next_fire(user_id: str, office_id: str, next_fire_at: datetime) -> bool:
    """Seed the FIRST future window for a newly-seen scheduled office. Guarded
    by ``next_fire_at is null`` so history is never back-filled and two racing
    ticks can't both seed (only the first wins). Seeding fires no run. Returns
    True iff this caller seeded the row."""
    pool = db.require()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "update offices set next_fire_at = $3 "
            "where id = $1 and user_id = $2 and next_fire_at is null "
            "returning id",
            office_id, user_id, next_fire_at,
        )
    return r is not None


async def claim_fire(
    user_id: str, office_id: str, window: datetime, next_fire_at: datetime
) -> bool:
    """Compare-and-swap the due window — the exactly-once-per-window anchor.

    Advances next_fire_at from the observed ``window`` to the following one and
    stamps last_fired_at, but ONLY while the row still shows ``window``. The
    single conditional UPDATE means exactly one racing tick/replica wins a given
    window and everyone else no-ops — durably, across ticks, restarts and
    replicas, with or without Redis. Returns True iff this caller won the claim
    (and must therefore enqueue the run)."""
    pool = db.require()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "update offices set last_fired_at = $3, next_fire_at = $4 "
            "where id = $1 and user_id = $2 and next_fire_at = $3 "
            "returning id",
            office_id, user_id, window, next_fire_at,
        )
    return r is not None
