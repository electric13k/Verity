"""Entitlements + usage-metering repo (0005_entitlements.sql).

Server-authoritative anti-tamper store. Identity is ALWAYS the gateway-injected
``user_id`` (gRPC metadata) — never a request body — so a tampered client bundle
cannot change which plan, quota, or usage row it reads or writes. Every function
filters by that user_id; a forgotten filter is a missing required argument, so it
fails to run rather than leaking or over-granting cross-tenant.

The ledger is append-only (mirrors the M7 compute credits ledger discipline):
current-window usage = ``sum(amount)`` over the window; the reservation row is the
authoritative charge, written BEFORE the gated action runs.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass

import asyncpg

from app.db import db, ensure_user

# metric name → the plan column that caps it. Metrics absent here have no plan
# column (treated as unlimited unless an override supplies a cap).
METRIC_COLUMN: dict[str, str] = {
    "messages": "messages_per_day",
    "tokens": "tokens_per_day",
    "flows": "flows_per_day",
    "offices": "offices_per_day",
    "uploads": "uploads_per_day",
    "compute": "compute_credits_per_day",
    "house_calls": "house_calls_per_day",
}

# Metrics the frontend/snapshot enumerates, in display order.
KNOWN_METRICS: tuple[str, ...] = tuple(METRIC_COLUMN.keys())

DEFAULT_PLAN_ID = "free"


@dataclass(frozen=True)
class PlanView:
    """A user's effective plan: the plan row with per-user overrides applied and
    the account status. ``limit_for`` returns the effective window cap for a
    metric (None = unlimited)."""

    plan_id: str
    plan_name: str
    status: str
    columns: dict          # plan quota columns (metric_column → value|None)
    overrides: dict        # metric-name → int cap (supersedes the column)
    features: dict

    @property
    def active(self) -> bool:
        return self.status == "active"

    def limit_for(self, metric: str) -> int | None:
        """Effective cap for ``metric``: override wins, else the plan column;
        None means unlimited. A non-active account caps everything at 0 (fail
        closed — a suspended user cannot spend)."""
        if not self.active:
            return 0
        if metric in self.overrides:
            try:
                return int(self.overrides[metric])
            except (TypeError, ValueError):
                pass
        col = METRIC_COLUMN.get(metric)
        if col is None:
            return None  # no column for this metric → unlimited unless overridden
        return self.columns.get(col)


@dataclass(frozen=True)
class ReserveResult:
    allowed: bool
    limit: int | None       # None = unlimited
    remaining: int | None   # None = unlimited
    used: int               # window usage BEFORE this reservation
    plan_id: str
    replay: bool = False     # True = idempotent replay (already recorded; not re-charged)


def _as_dict(value) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    return json.loads(value)


async def plan_for_user(user_id: str) -> PlanView:
    """The user's effective plan. A missing entitlement row is treated as the
    canonical free plan (same default the migration backfills), so reads are
    consistent whether or not the lazy upsert has run yet."""
    pool = db.require()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "select p.id as plan_id, p.name as plan_name, p.features, "
            "       p.messages_per_day, p.tokens_per_day, p.flows_per_day, "
            "       p.offices_per_day, p.uploads_per_day, p.compute_credits_per_day, "
            "       p.house_calls_per_day, p.max_offices, "
            "       ue.overrides, ue.status "
            "from user_entitlements ue join plans p on p.id = ue.plan_id "
            "where ue.user_id = $1",
            user_id,
        )
        if row is None:
            # No entitlement row yet → the free plan, active by default.
            row = await conn.fetchrow(
                "select id as plan_id, name as plan_name, features, "
                "       messages_per_day, tokens_per_day, flows_per_day, "
                "       offices_per_day, uploads_per_day, compute_credits_per_day, "
                "       house_calls_per_day, max_offices, "
                "       '{}'::jsonb as overrides, 'active' as status "
                "from plans where id = $1",
                DEFAULT_PLAN_ID,
            )
        if row is None:
            # Plans table not seeded (migration not applied): unlimited-but-named
            # so callers still get a coherent view. Enforcement callers gate on
            # db.available/entitlements separately.
            return PlanView(DEFAULT_PLAN_ID, "Free", "active", {}, {}, {})
    cols = {
        k: row[k]
        for k in (
            "messages_per_day", "tokens_per_day", "flows_per_day",
            "offices_per_day", "uploads_per_day", "compute_credits_per_day",
            "house_calls_per_day", "max_offices",
        )
    }
    return PlanView(
        plan_id=row["plan_id"],
        plan_name=row["plan_name"],
        status=row["status"],
        columns=cols,
        overrides=_as_dict(row["overrides"]),
        features=_as_dict(row["features"]),
    )


async def usage_today(user_id: str, metric: str) -> int:
    """Current-window (UTC day) usage for (user, metric): sum(amount)."""
    pool = db.require()
    async with pool.acquire() as conn:
        val = await conn.fetchval(
            "select coalesce(sum(amount), 0) from usage_ledger "
            "where user_id = $1 and metric = $2 "
            "and created_at >= date_trunc('day', now() at time zone 'utc')",
            user_id, metric,
        )
    return int(val or 0)


async def reserve(
    user_id: str, metric: str, amount: int, idempotency_key: str
) -> ReserveResult:
    """Atomically check quota and append the metered charge.

    Anti-tamper + correctness properties:
      * Serialized per (user, metric) by a transaction-scoped advisory lock, so
        two concurrent reservations can never both slip past a nearly-full quota.
      * Idempotent on ``idempotency_key`` (UNIQUE): a retried reservation is
        detected and returns the ORIGINAL decision without charging twice.
      * The plan/usage the decision is made against are read here from the DB by
        this user_id — nothing the client sends is trusted.

    Denials do NOT write a ledger row (only granted units are charged)."""
    amount = max(int(amount or 1), 1)
    key = idempotency_key.strip() or f"auto:{uuid.uuid4()}"
    plan = await plan_for_user(user_id)
    limit = plan.limit_for(metric)

    pool = db.require()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await ensure_user(conn, user_id)
            # Lazily default this user to the free tier (matches the migration
            # backfill). Never overwrites an existing plan.
            await conn.execute(
                "insert into user_entitlements (user_id, plan_id) values ($1, $2) "
                "on conflict (user_id) do nothing",
                user_id, DEFAULT_PLAN_ID,
            )
            # Serialize reservations for this user+metric (see docstring).
            await conn.execute(
                "select pg_advisory_xact_lock(hashtextextended($1, 0))",
                f"ent:{user_id}:{metric}",
            )
            existing = await conn.fetchrow(
                "select amount from usage_ledger where idempotency_key = $1",
                key,
            )
            if existing is not None:
                # Idempotent replay: same reservation, already charged. Return the
                # granted result — never deny, never double-charge.
                used = await conn.fetchval(
                    "select coalesce(sum(amount), 0) from usage_ledger "
                    "where user_id = $1 and metric = $2 "
                    "and created_at >= date_trunc('day', now() at time zone 'utc')",
                    user_id, metric,
                )
                used = int(used or 0)
                remaining = None if limit is None else max(limit - used, 0)
                return ReserveResult(
                    allowed=True, limit=limit, remaining=remaining,
                    used=used - int(existing["amount"]), plan_id=plan.plan_id,
                    replay=True,
                )

            used = await conn.fetchval(
                "select coalesce(sum(amount), 0) from usage_ledger "
                "where user_id = $1 and metric = $2 "
                "and created_at >= date_trunc('day', now() at time zone 'utc')",
                user_id, metric,
            )
            used = int(used or 0)

            if limit is not None and used + amount > limit:
                # Over quota (or suspended → limit 0): deny, write nothing.
                return ReserveResult(
                    allowed=False, limit=limit, remaining=max(limit - used, 0),
                    used=used, plan_id=plan.plan_id,
                )

            await conn.execute(
                "insert into usage_ledger (user_id, metric, amount, idempotency_key) "
                "values ($1, $2, $3, $4)",
                user_id, metric, amount, key,
            )
            remaining = None if limit is None else max(limit - used - amount, 0)
            return ReserveResult(
                allowed=True, limit=limit, remaining=remaining,
                used=used, plan_id=plan.plan_id,
            )


async def set_plan(user_id: str, plan_id: str, *, status: str = "active") -> None:
    """Assign/replace a user's plan (admin/billing path — never a request body).
    Upserts the entitlement row. Kept here so the store has one writer."""
    pool = db.require()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await ensure_user(conn, user_id)
            await conn.execute(
                "insert into user_entitlements (user_id, plan_id, status) "
                "values ($1, $2, $3) "
                "on conflict (user_id) do update set "
                "plan_id = excluded.plan_id, status = excluded.status, "
                "updated_at = now()",
                user_id, plan_id, status,
            )
