"""Cron parsing / next-fire computation for the G3 office scheduler.

croniter is an OPTIONAL, lazily-imported dependency (`pip install
verity-brain[scheduler]`). When it is not installed the scheduler still runs
but computes no fire times — ``next_fire`` returns None, so no office is ever
scheduled. The absence is logged exactly once and reported by /healthz. Boot
degrades, never dies; no new REQUIRED dependency.

All times are timezone-aware UTC (to match the ``timestamptz`` columns 0004
adds). A naive input is treated as UTC.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("brain.scheduler")

_croniter_cls = None
_checked = False


def _croniter():
    """Return the croniter class, or None if the optional dep is absent.
    Import is attempted once; absence is logged a single time."""
    global _croniter_cls, _checked
    if not _checked:
        _checked = True
        try:
            from croniter import croniter as cls

            _croniter_cls = cls
        except Exception as exc:  # not installed / import error → no scheduling
            _croniter_cls = None
            log.warning(
                "croniter not installed (%s); scheduled offices will NOT fire "
                "(install verity-brain[scheduler] to enable)",
                exc,
            )
    return _croniter_cls


def available() -> bool:
    """True when a cron engine is present (so offices can be scheduled)."""
    return _croniter() is not None


def is_valid(expr: str) -> bool:
    cls = _croniter()
    if cls is None or not expr:
        return False
    try:
        return bool(cls.is_valid(expr))
    except Exception:
        return False


def next_fire(expr: str, after: datetime) -> datetime | None:
    """Next occurrence of ``expr`` strictly after ``after`` (tz-aware UTC), or
    None if croniter is absent or the expression is invalid."""
    cls = _croniter()
    if cls is None or not expr:
        return None
    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)
    try:
        nxt = cls(expr, after).get_next(datetime)
    except Exception as exc:  # malformed expression — skip this office
        log.warning("invalid cron %r: %s", expr, exc)
        return None
    if nxt.tzinfo is None:
        nxt = nxt.replace(tzinfo=timezone.utc)
    return nxt
