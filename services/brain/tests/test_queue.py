"""G12 async run queue: in-process pool + per-user cap, the degrade-aware
backend factory, and the Redis backend's claim/lease/reap units (fakeredis).

We exercise BOTH backends: the in-process path (the Redis-absent default) and
the Redis path via fakeredis (an injected async client), stated per test.
"""

from __future__ import annotations

import asyncio
import sys

import pytest

from app.queue import build_queue, job_queue
from app.queue.base import Job, UserGate
from app.queue.inprocess import InProcessQueue
from app.offices.runner import PER_USER_CONCURRENCY_CAP


def _office_job(user_id: str, office_id: str = "o", run_id: str = "r") -> Job:
    return Job(kind="office", user_id=user_id, payload={"office_id": office_id, "run_id": run_id})


# --- backend factory degrade ---------------------------------------------

def test_singleton_is_inprocess_without_redis():
    # Default test env has no REDIS_URL → the process singleton is in-process.
    assert isinstance(job_queue, InProcessQueue)
    assert job_queue.backend == "in-process"


def test_build_queue_inprocess_when_no_redis_url(monkeypatch):
    monkeypatch.setattr("app.queue.settings.redis_url", None, raising=False)
    q = build_queue()
    assert isinstance(q, InProcessQueue)


def test_build_queue_degrades_when_redis_pkg_missing(monkeypatch):
    # REDIS_URL is set, but the optional `redis` package can't import → the
    # factory must degrade to in-process, never raise (boot degrades, never dies).
    monkeypatch.setattr("app.queue.settings.redis_url", "redis://localhost:6379/0", raising=False)
    monkeypatch.setitem(sys.modules, "redis", None)  # `import redis` now raises ImportError
    q = build_queue()
    assert isinstance(q, InProcessQueue)


# --- in-process: per-user concurrency cap --------------------------------

async def test_inprocess_worker_respects_per_user_cap():
    """cap=1: a single user's two jobs never run concurrently, but two
    different users DO run concurrently — the UserGate bounds per-user, not
    globally."""
    q = InProcessQueue(workers=4, cap=1)
    active: dict[str, int] = {}
    peak: dict[str, int] = {}
    completed: list[str] = []
    started = asyncio.Semaphore(0)
    release = asyncio.Event()

    async def handler(job: Job) -> None:
        u = job.user_id
        active[u] = active.get(u, 0) + 1
        peak[u] = max(peak.get(u, 0), active[u])
        started.release()
        await release.wait()          # hold so concurrency is observable
        active[u] -= 1
        completed.append(job.payload["run_id"])

    await q.start(handler)
    for i in range(2):
        await q.enqueue(_office_job("A", run_id=f"a{i}"))
    for i in range(2):
        await q.enqueue(_office_job("B", run_id=f"b{i}"))

    # Two jobs reach the handler and hold. With cap=1 they must be one A + one B.
    await asyncio.wait_for(started.acquire(), 1)
    await asyncio.wait_for(started.acquire(), 1)
    assert active.get("A", 0) <= 1
    assert active.get("B", 0) <= 1
    assert sorted(u for u, n in active.items() if n > 0) == ["A", "B"]

    release.set()
    await asyncio.wait_for(q._q.join(), 2)   # drain all four
    await q.stop()

    assert len(completed) == 4
    assert peak == {"A": 1, "B": 1}          # per-user cap held throughout


async def test_inprocess_default_cap_matches_office_cap():
    q = InProcessQueue()
    assert q.health()["cap"] == PER_USER_CONCURRENCY_CAP


async def test_inprocess_bad_job_does_not_kill_worker():
    q = InProcessQueue(workers=1)
    ran: list[str] = []

    async def handler(job: Job) -> None:
        if job.payload["run_id"] == "boom":
            raise RuntimeError("handler blew up")
        ran.append(job.payload["run_id"])

    await q.start(handler)
    await q.enqueue(_office_job("A", run_id="boom"))
    await q.enqueue(_office_job("A", run_id="ok"))
    await asyncio.wait_for(q._q.join(), 2)
    await q.stop()
    assert ran == ["ok"]     # the good job still ran after the bad one failed


def test_usergate_bounds_per_user():
    gate = UserGate(cap=2)
    assert gate.cap == 2
    s = gate.semaphore("u1")
    assert gate.semaphore("u1") is s          # stable per user
    assert gate.semaphore("u2") is not s


# --- Job serialization / lease keys --------------------------------------

def test_job_roundtrip_and_lease_keys():
    j = _office_job("u", office_id="off1", run_id="run1")
    back = Job.from_json(j.to_json())
    assert back.id == j.id and back.user_id == "u" and back.payload == j.payload
    # office runs serialize per OFFICE (single-flight); flow runs per RUN.
    assert j.lease_id == "office:off1"
    f = Job(kind="flow", user_id="u", payload={"run_id": "run9"})
    assert f.lease_id == "flow:run9"
    r = j.retry()
    assert r.id == j.id and r.attempts == 1     # retry keeps identity, bumps attempts


# --- Redis backend units (fakeredis) -------------------------------------

fakeredis = pytest.importorskip("fakeredis")
from app.queue.redis_queue import INFLIGHT, MAX_ATTEMPTS, PENDING, RedisQueue  # noqa: E402


def _fake_client():
    return fakeredis.FakeAsyncRedis(decode_responses=True)


async def test_redis_enqueue_claim_complete():
    client = _fake_client()
    rq = RedisQueue(client=client)
    job = _office_job("u", office_id="o1", run_id="r1")
    await rq.enqueue(job)

    claimed = await rq._claim()
    assert claimed is not None and claimed.id == job.id
    assert await client.zcard(INFLIGHT) == 1
    assert await client.get(rq._lease_key(job.lease_id)) == job.id   # per-run lease held

    await rq._complete(claimed)
    assert await client.zcard(INFLIGHT) == 0
    assert await client.get(rq._lease_key(job.lease_id)) is None     # lease released
    assert await client.get(rq._data_key(job.id)) is None            # data cleaned up


async def test_redis_single_flight_lease_blocks_same_office():
    """Two queued runs of the SAME office: only one can be claimed at a time —
    the per-office lease prevents a concurrent double-run."""
    client = _fake_client()
    rq = RedisQueue(client=client)
    j1 = _office_job("u", office_id="o", run_id="r1")
    j2 = _office_job("u", office_id="o", run_id="r2")
    await rq.enqueue(j1)
    await rq.enqueue(j2)

    c1 = await rq._claim()
    assert c1 is not None
    c2 = await rq._claim()               # same office lease held → pushed back
    assert c2 is None
    assert await client.llen(PENDING) == 1

    await rq._complete(c1)               # releases the office lease
    c3 = await rq._claim()               # now the second run is claimable
    assert c3 is not None
    assert c3.lease_id == c1.lease_id


async def test_redis_reaper_redelivers_after_visibility_timeout():
    now = {"t": 1000.0}
    client = _fake_client()
    rq = RedisQueue(client=client, visibility_timeout=30.0, time_fn=lambda: now["t"])
    job = _office_job("u", office_id="o", run_id="r")
    await rq.enqueue(job)

    claimed = await rq._claim()          # inflight score = 1000 + 30 = 1030
    assert claimed is not None
    assert await rq._reap() == 0         # not yet expired

    now["t"] = 1031.0
    assert await rq._reap() == 1         # crashed worker's job redelivered
    assert await client.llen(PENDING) == 1
    body = Job.from_json(await client.get(rq._data_key(job.id)))
    assert body.attempts == 1            # at-least-once redelivery, attempt bumped


async def test_redis_fail_requeues_then_drops_at_max():
    client = _fake_client()
    rq = RedisQueue(client=client)
    j = _office_job("u", office_id="o", run_id="r")
    await client.set(rq._data_key(j.id), j.to_json())
    await rq._fail(j)                    # attempts 0 → 1, requeued
    assert await client.llen(PENDING) == 1
    assert Job.from_json(await client.get(rq._data_key(j.id))).attempts == 1

    jmax = Job(kind="office", user_id="u", payload={"office_id": "o2", "run_id": "r2"},
               attempts=MAX_ATTEMPTS - 1)
    await client.set(rq._data_key(jmax.id), jmax.to_json())
    before = await client.llen(PENDING)
    await rq._fail(jmax)                 # would exceed MAX_ATTEMPTS → dropped
    assert await client.llen(PENDING) == before
    assert await client.get(rq._data_key(jmax.id)) is None


async def test_redis_worker_runs_job_end_to_end():
    client = _fake_client()
    rq = RedisQueue(client=client, workers=1, poll_interval=0.01, reap_interval=1000)
    ran = asyncio.Event()
    seen: dict[str, Job] = {}

    async def handler(job: Job) -> None:
        seen["job"] = job
        ran.set()

    await rq.start(handler)
    await rq.enqueue(_office_job("u", office_id="o", run_id="r"))
    await asyncio.wait_for(ran.wait(), 2)
    await rq.stop()

    assert seen["job"].payload["office_id"] == "o"
    assert await client.zcard(INFLIGHT) == 0            # completed & cleaned up


async def test_redis_worker_respects_per_user_cap():
    """The Redis backend enforces the same per-user cap via its UserGate."""
    client = _fake_client()
    rq = RedisQueue(client=client, workers=4, cap=1, poll_interval=0.01, reap_interval=1000)
    peak: dict[str, int] = {}
    active: dict[str, int] = {}
    completed = asyncio.Semaphore(0)
    release = asyncio.Event()

    async def handler(job: Job) -> None:
        u = job.user_id
        active[u] = active.get(u, 0) + 1
        peak[u] = max(peak.get(u, 0), active[u])
        await release.wait()
        active[u] -= 1
        completed.release()

    await rq.start(handler)
    # two DIFFERENT offices for the same user (distinct leases) so only the
    # per-user cap — not the per-office lease — bounds concurrency.
    await rq.enqueue(_office_job("A", office_id="o1", run_id="r1"))
    await rq.enqueue(_office_job("A", office_id="o2", run_id="r2"))
    await asyncio.sleep(0.1)
    assert peak.get("A", 0) == 1        # cap=1: same user never runs 2 at once
    release.set()
    await asyncio.wait_for(completed.acquire(), 2)
    await asyncio.wait_for(completed.acquire(), 2)
    await rq.stop()
    assert peak["A"] == 1
