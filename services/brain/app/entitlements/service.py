"""Entitlement + metering service — the brain-side authority the gateway calls.

Design laws honoured here:

  * Server-authoritative identity. Every decision is made for the ``user_id`` the
    gateway put in gRPC metadata (passed in by the caller from require_tenant);
    plan and usage are read from the DB, never from anything the client controls.
    A tampered browser bundle that claims a plan or a usage count changes nothing.

  * Boot degrades, never dies — with the SAFE default:
      - Entitlements OFF (default, VERITY_ENTITLEMENTS unset): every check is
        ALLOWED and marked ``enforced=False``. Local dev / echo runs open with no
        DB. Quotas simply don't exist yet.
      - Entitlements ON but the store is unreachable: gated actions FAIL CLOSED
        (denied) with a clear reason. A required check we cannot complete denies
        the action — a forgotten/undeliverable check is never a free pass.
      - Entitlements ON and store reachable: real quota enforcement.

  * Idempotent metering — replay of the same reservation key never double-charges
    (delegated to repos.entitlements.reserve, which is UNIQUE-key idempotent).

The service is intentionally thin and DB-boundary-aware so it is unit-testable
against fakes; all SQL lives in repos.entitlements.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import settings
from app.db import db
from app.repos import entitlements as repo


@dataclass(frozen=True)
class Decision:
    """The result of a check_and_reserve. ``enforced`` is False when entitlements
    are disabled (dev open mode), in which case ``allowed`` is trivially True."""

    allowed: bool
    enforced: bool
    reason: str = ""
    limit: int = -1           # -1 = unlimited (proto/gateway convention)
    remaining: int = -1       # -1 = unlimited
    plan_id: str = ""
    retry_after_seconds: int = 0


@dataclass(frozen=True)
class MetricSnapshot:
    metric: str
    limit: int   # -1 = unlimited
    used: int
    remaining: int  # -1 = unlimited


@dataclass(frozen=True)
class EntitlementSnapshot:
    plan_id: str
    plan_name: str
    status: str
    enforced: bool
    metrics: list[MetricSnapshot]


# Seconds until the current UTC day rolls over — the window all daily quotas use.
def _seconds_until_window_end() -> int:
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return max(int((tomorrow - now).total_seconds()), 0)


def enabled() -> bool:
    return settings.entitlements_enabled


def store_status() -> str:
    """For /healthz. One of: disabled | ready | unavailable."""
    if not settings.entitlements_enabled:
        return "disabled"
    return "ready" if db.available else "unavailable"


def _neg1(value: int | None) -> int:
    return -1 if value is None else int(value)


async def check_and_reserve(
    user_id: str, metric: str, amount: int, idempotency_key: str
) -> Decision:
    """Verify quota and atomically reserve ``amount`` of ``metric`` for the user.

    This is the ONE call the gateway makes before a metered action reaches the
    AI. See module docstring for the degrade matrix."""
    if not settings.entitlements_enabled:
        # Dev open mode: no quotas. Marked not-enforced so callers can tell the
        # allow apart from a real quota grant.
        return Decision(allowed=True, enforced=False, plan_id="")
    if not db.available:
        # Enforcement is required but the store is down → fail closed.
        return Decision(
            allowed=False,
            enforced=True,
            reason="entitlement store unavailable; gated action denied",
        )
    result = await repo.reserve(user_id, metric, amount, idempotency_key)
    retry = _seconds_until_window_end() if not result.allowed else 0
    return Decision(
        allowed=result.allowed,
        enforced=True,
        reason="" if result.allowed else f"{metric} quota exceeded for this window",
        limit=_neg1(result.limit),
        remaining=_neg1(result.remaining),
        plan_id=result.plan_id,
        retry_after_seconds=retry,
    )


async def enforce_house_cap(user_id: str) -> None:
    """Gate the house ("provided by Verity") model path against the per-user daily
    cap. READ-ONLY peek (no reservation) so repeated fail-fast resolves never
    consume the cap; the authoritative count is reserved at execution time via
    ``reserve_house_call``.

    Raises ProviderError (user-safe) when the cap is reached. Degrade matrix:
      * entitlements OFF: cap comes from VERITY_HOUSE_DAILY_CAP if set, else no
        cap (dev open). Uses the ledger only when the DB is present.
      * entitlements ON, store down: fail closed (raise).
      * entitlements ON, store up: cap from the user's plan/overrides.
    """
    # Imported here to avoid a providers→entitlements import cycle at module load.
    from app.providers.base import ProviderError

    if not settings.entitlements_enabled:
        cap = settings.house_daily_cap
        if cap is None or not db.available:
            return  # uncapped (or no store to count against) → dev open
        used = await repo.usage_today(user_id, "house_calls")
        if used >= cap:
            raise ProviderError(
                "house model daily limit reached; add your own provider key or try tomorrow"
            )
        return

    if not db.available:
        raise ProviderError("house models unavailable (entitlement store down)")

    plan = await repo.plan_for_user(user_id)
    cap = plan.limit_for("house_calls")
    if cap is None:
        return  # unlimited for this plan
    used = await repo.usage_today(user_id, "house_calls")
    if used >= cap:
        raise ProviderError(
            "house model daily limit reached for your plan; add your own provider key or upgrade"
        )


async def reserve_house_call(user_id: str, idempotency_key: str) -> bool:
    """Record one house-model call against the daily cap (authoritative count).
    Idempotent on the key. Returns False when it would exceed the cap (caller
    may abort). A no-op that returns True when there is nothing to enforce
    (entitlements off + no env cap, or no DB)."""
    if not settings.entitlements_enabled and settings.house_daily_cap is None:
        return True
    if not db.available:
        # ON + down already blocked in enforce_house_cap; OFF + capped but no DB
        # cannot count, so allow (nothing to write to).
        return not settings.entitlements_enabled

    # When entitlements are OFF but an env cap is set, enforce that env cap here
    # (plan_for_user would report the plan cap, which we only honour when ON).
    if not settings.entitlements_enabled:
        cap = settings.house_daily_cap
        used = await repo.usage_today(user_id, "house_calls")
        if cap is not None and used >= cap:
            return False
        # Record without the plan machinery.
        result = await repo.reserve(user_id, "house_calls", 1, idempotency_key)
        return result.allowed or result.replay

    result = await repo.reserve(user_id, "house_calls", 1, idempotency_key)
    return result.allowed or result.replay


async def snapshot(user_id: str) -> EntitlementSnapshot:
    """Read-only plan + per-metric current-window usage, for the frontend to
    DISPLAY. Never used for enforcement. Degrades to a disabled/empty view when
    entitlements are off or the store is down (so /v1/entitlements never errors
    the UI)."""
    if not settings.entitlements_enabled or not db.available:
        return EntitlementSnapshot(
            plan_id="", plan_name="", status="",
            enforced=settings.entitlements_enabled and db.available,
            metrics=[],
        )
    plan = await repo.plan_for_user(user_id)
    metrics: list[MetricSnapshot] = []
    for metric in repo.KNOWN_METRICS:
        limit = plan.limit_for(metric)
        used = await repo.usage_today(user_id, metric)
        remaining = -1 if limit is None else max(limit - used, 0)
        metrics.append(
            MetricSnapshot(
                metric=metric, limit=_neg1(limit), used=used, remaining=remaining
            )
        )
    return EntitlementSnapshot(
        plan_id=plan.plan_id,
        plan_name=plan.plan_name,
        status=plan.status,
        enforced=True,
        metrics=metrics,
    )
