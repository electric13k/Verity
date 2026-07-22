"""G3 office scheduler: exactly-once-per-window firing, the seed/CAS bookkeeping,
real croniter next-fire, and the degrade-never-die paths (croniter absent,
scheduler disabled, DB down, Redis tick-lease present/absent).

The durable exactly-once anchor is the ``next_fire_at`` compare-and-swap in the
offices repo. We drive the scheduler against an in-memory FAKE repo that mirrors
that CAS exactly (atomic check-and-advance, no yield between read and write),
plus a spy queue that records the Jobs the scheduler enqueues. Cron math uses
REAL croniter (a dev extra), stated per test.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.db import DBUnavailable
from app.queue.base import Job
from app.repos.offices import DueOffice
from app.scheduler import cron
from app.scheduler.core import OfficeScheduler

UTC = timezone.utc


# --- fakes ----------------------------------------------------------------


class SpyQueue:
    """Records enqueued Jobs; can be told to fail enqueue (crash simulation)."""

    def __init__(self, *, fail: bool = False) -> None:
        self.jobs: list[Job] = []
        self.fail = fail

    async def enqueue(self, job: Job) -> None:
        if self.fail:
            raise RuntimeError("queue down")
        self.jobs.append(job)


class FakeOfficesRepo:
    """In-memory mirror of the G3 repo bookkeeping. ``claim_fire`` is an atomic
    conditional advance — exactly the durable CAS the real UPDATE performs — so
    two ticks/replicas handed the same window row can never both win."""

    def __init__(self, offices: list[DueOffice]) -> None:
        self.rows: dict[str, dict] = {
            o.id: {
                "user_id": o.user_id,
                "schedule_cron": o.schedule_cron,
                "next_fire_at": o.next_fire_at,
                "last_fired_at": None,
                "enabled": True,
            }
            for o in offices
        }
        self.run_seq = 0
        self.started_runs: list[tuple[str, str, str]] = []  # (run_id, user_id, office_id)
        self.finished: list[tuple[str, str, str]] = []      # (run_id, user_id, status)
        self.scan_calls = 0
        self.due_delay = 0.0  # inject an await so concurrent ticks can interleave

    async def due_for_scheduling(self, now: datetime, *, limit: int = 500) -> list[DueOffice]:
        self.scan_calls += 1
        if self.due_delay:
            await asyncio.sleep(self.due_delay)
        out = []
        for oid, r in self.rows.items():
            if not (r["enabled"] and r["schedule_cron"]):
                continue
            if r["next_fire_at"] is None or r["next_fire_at"] <= now:
                out.append(
                    DueOffice(
                        id=oid,
                        user_id=r["user_id"],
                        schedule_cron=r["schedule_cron"],
                        next_fire_at=r["next_fire_at"],
                    )
                )
        return out

    async def seed_next_fire(self, user_id: str, office_id: str, next_fire_at: datetime) -> bool:
        r = self.rows[office_id]
        if r["user_id"] != user_id or r["next_fire_at"] is not None:
            return False
        r["next_fire_at"] = next_fire_at
        return True

    async def claim_fire(
        self, user_id: str, office_id: str, window: datetime, next_fire_at: datetime
    ) -> bool:
        # Atomic check-and-advance: no await between the compare and the swap,
        # so this is the single-winner CAS the DB performs.
        r = self.rows[office_id]
        if r["user_id"] != user_id or r["next_fire_at"] != window:
            return False
        r["next_fire_at"] = next_fire_at
        r["last_fired_at"] = window
        return True

    async def start_run(self, user_id: str, office_id: str) -> str:
        self.run_seq += 1
        rid = f"run-{self.run_seq}"
        self.started_runs.append((rid, user_id, office_id))
        return rid

    async def finish_run(self, user_id: str, run_id: str, status: str, state_md: str) -> None:
        self.finished.append((run_id, user_id, status))


CRON = "*/5 * * * *"           # every 5 minutes
NOW = datetime(2026, 7, 22, 10, 2, tzinfo=UTC)
WINDOW = datetime(2026, 7, 22, 10, 0, tzinfo=UTC)   # a due (past) window


def _due_office(oid="o1", user="u1", cron_expr=CRON, next_fire_at=WINDOW) -> DueOffice:
    return DueOffice(id=oid, user_id=user, schedule_cron=cron_expr, next_fire_at=next_fire_at)


def _sched(queue, repo, **kw) -> OfficeScheduler:
    kw.setdefault("enabled", True)
    kw.setdefault("time_fn", lambda: NOW)
    return OfficeScheduler(queue=queue, repo=repo, **kw)


# --- cron (real croniter) -------------------------------------------------


def test_cron_available_and_validation():
    assert cron.available() is True
    assert cron.is_valid(CRON) is True
    assert cron.is_valid("not a cron") is False
    assert cron.is_valid("") is False


def test_cron_next_fire_is_future_and_aligned():
    nxt = cron.next_fire(CRON, NOW)
    assert nxt == datetime(2026, 7, 22, 10, 5, tzinfo=UTC)   # strictly after 10:02
    assert nxt.tzinfo is not None                             # tz-aware UTC


def test_cron_next_fire_naive_input_treated_as_utc():
    nxt = cron.next_fire(CRON, datetime(2026, 7, 22, 10, 2))  # naive → UTC
    assert nxt == datetime(2026, 7, 22, 10, 5, tzinfo=UTC)


def test_cron_next_fire_invalid_returns_none():
    assert cron.next_fire("nonsense expr", NOW) is None
    assert cron.next_fire("", NOW) is None


# --- seed on first sight (never back-fills history) -----------------------


async def test_first_sight_seeds_next_window_and_does_not_fire():
    repo = FakeOfficesRepo([_due_office(next_fire_at=None)])   # unseeded
    q = SpyQueue()
    await _sched(q, repo).tick()
    assert q.jobs == []                                        # no fire on first sight
    assert repo.rows["o1"]["next_fire_at"] == cron.next_fire(CRON, NOW)  # seeded forward


# --- exactly-once per window ----------------------------------------------


async def test_due_office_fires_once_and_carries_owner_user_id():
    repo = FakeOfficesRepo([_due_office(user="owner-42")])
    q = SpyQueue()
    await _sched(q, repo).tick()
    assert len(q.jobs) == 1
    job = q.jobs[0]
    assert job.kind == "office"
    assert job.user_id == "owner-42"          # STORED owner, never a body
    assert job.payload["office_id"] == "o1"
    assert job.payload["run_id"] == "run-1"
    assert repo.rows["o1"]["last_fired_at"] == WINDOW
    assert repo.rows["o1"]["next_fire_at"] == cron.next_fire(CRON, NOW)  # window advanced


async def test_second_tick_same_window_does_not_double_fire():
    """Two ticks at the same instant: the first advances next_fire_at past now,
    so the second tick's due scan no longer returns the office."""
    repo = FakeOfficesRepo([_due_office()])
    q = SpyQueue()
    sched = _sched(q, repo)
    await sched.tick()
    await sched.tick()
    assert len(q.jobs) == 1                    # exactly once across two ticks


async def test_cas_dedups_two_replicas_on_the_same_window():
    """Simulate two replicas that BOTH observed the same due row before either
    claimed (identical DueOffice / window handed to _process twice). The CAS
    lets exactly one win — the durable exactly-once anchor, no Redis involved."""
    repo = FakeOfficesRepo([_due_office()])
    q = SpyQueue()
    sched = _sched(q, repo)
    office = _due_office()                      # both replicas' snapshot of the row
    await sched._process(office, NOW)           # replica A: claims + enqueues
    await sched._process(office, NOW)           # replica B: stale window → CAS loses
    assert len(q.jobs) == 1
    assert repo.run_seq == 1                    # only one run row created


async def test_concurrent_ticks_fire_once():
    """Two ticks racing through an interleaved due scan still fire once — the
    atomic claim_fire serializes them."""
    repo = FakeOfficesRepo([_due_office()])
    repo.due_delay = 0.01                       # force the two scans to overlap
    q = SpyQueue()
    sched = _sched(q, repo)
    await asyncio.gather(sched.tick(), sched.tick())
    assert len(q.jobs) == 1


async def test_restart_after_fire_does_not_double_fire():
    """A restart mid-window: next_fire_at is durable in the repo, so a FRESH
    scheduler bound to the same repo re-ticking the same window fires nothing."""
    repo = FakeOfficesRepo([_due_office()])
    q = SpyQueue()
    await _sched(q, repo).tick()                # replica 1 fires
    assert len(q.jobs) == 1
    # "restart": a brand-new scheduler instance over the SAME durable repo.
    await _sched(q, repo).tick()
    assert len(q.jobs) == 1                     # window already claimed → no double-fire


async def test_crash_between_claim_and_enqueue_is_a_missed_window_not_a_double_fire():
    """If enqueue fails after the claim, the window is already advanced: the run
    is marked failed and a subsequent tick will NOT re-fire the same window
    (claim-before-enqueue means a crash there loses a window, never doubles)."""
    repo = FakeOfficesRepo([_due_office()])
    failing = SpyQueue(fail=True)
    await _sched(failing, repo).tick()
    assert failing.jobs == []                                  # nothing enqueued
    assert repo.rows["o1"]["next_fire_at"] == cron.next_fire(CRON, NOW)  # window consumed
    assert repo.finished and repo.finished[-1][2] == "failed"  # run marked failed
    # A healthy retick does not re-fire the lost window.
    ok = SpyQueue()
    await _sched(ok, repo).tick()
    assert ok.jobs == []


async def test_invalid_cron_office_is_skipped_not_fired():
    repo = FakeOfficesRepo([_due_office(cron_expr="totally bogus")])
    q = SpyQueue()
    await _sched(q, repo).tick()
    assert q.jobs == []                         # invalid expr → skipped, no crash


# --- degrade: never die ---------------------------------------------------


async def test_disabled_scheduler_never_starts():
    repo = FakeOfficesRepo([_due_office()])
    q = SpyQueue()
    sched = _sched(q, repo, enabled=False)
    await sched.start()
    assert sched.health()["running"] is False
    assert sched.health()["enabled"] is False
    await sched.stop()                          # idempotent even when never started


async def test_croniter_absent_fires_nothing(monkeypatch):
    """No cron engine → tick scans nothing and fires nothing; boot still runs."""
    monkeypatch.setattr("app.scheduler.cron.available", lambda: False)
    repo = FakeOfficesRepo([_due_office()])
    q = SpyQueue()
    sched = _sched(q, repo)
    await sched.start()                         # logs, but does not raise
    await sched.tick()
    assert q.jobs == []
    assert repo.scan_calls == 0                 # short-circuits before the DB scan
    assert sched.health()["cron"] == "unavailable"
    await sched.stop()


async def test_tick_survives_db_unavailable():
    class DownRepo(FakeOfficesRepo):
        async def due_for_scheduling(self, now, *, limit=500):
            raise DBUnavailable("no pool")

    q = SpyQueue()
    sched = _sched(q, DownRepo([_due_office()]))
    await sched.tick()                          # must not raise
    assert q.jobs == []


async def test_tick_survives_one_bad_office(monkeypatch):
    """A single office raising during processing never stalls the whole scan —
    the other due office still fires."""
    repo = FakeOfficesRepo([_due_office("bad", "u1"), _due_office("good", "u1")])
    q = SpyQueue()
    sched = _sched(q, repo)
    real_claim = repo.claim_fire

    async def flaky_claim(user_id, office_id, window, nxt):
        if office_id == "bad":
            raise RuntimeError("boom")
        return await real_claim(user_id, office_id, window, nxt)

    monkeypatch.setattr(repo, "claim_fire", flaky_claim)
    await sched.tick()
    assert [j.payload["office_id"] for j in q.jobs] == ["good"]


# --- Redis tick lease (thundering-herd guard; fakeredis) ------------------


async def test_coordinator_degrades_to_local_without_redis():
    repo = FakeOfficesRepo([_due_office()])
    sched = _sched(SpyQueue(), repo)            # no redis_url / client
    assert sched.health()["coordination"] == "local"
    await sched.tick()                          # local guard always scans
    assert repo.scan_calls == 1


fakeredis = pytest.importorskip("fakeredis")


async def test_redis_tick_lease_lets_one_replica_scan_per_window():
    """Two replicas sharing a Redis tick lease: only ONE scans a given window
    (herd guard). The other skips the scan entirely — the CAS would dedup it
    anyway, but the lease spares the DB the duplicate scan."""
    client = fakeredis.FakeAsyncRedis(decode_responses=True)
    repo = FakeOfficesRepo([_due_office()])
    q1, q2 = SpyQueue(), SpyQueue()
    s1 = _sched(q1, repo, redis_client=client, tick_seconds=45)
    s2 = _sched(q2, repo, redis_client=client, tick_seconds=45)
    assert s1.health()["coordination"] == "redis"
    await s1.tick()                             # wins the window lease, scans, fires
    await s2.tick()                             # same window key held → skips scan
    assert len(q1.jobs) == 1
    assert q2.jobs == []
    assert repo.scan_calls == 1                 # second replica never scanned


async def test_redis_tick_lease_error_falls_back_to_scanning():
    """A Redis error taking the lease must not skip the window — scan anyway
    (the CAS still guarantees exactly-once)."""
    class BrokenClient:
        async def set(self, *a, **k):
            raise RuntimeError("redis down")

    repo = FakeOfficesRepo([_due_office()])
    q = SpyQueue()
    sched = _sched(q, repo, redis_client=BrokenClient(), tick_seconds=45)
    await sched.tick()
    assert len(q.jobs) == 1                     # degraded to scanning, still fired once
