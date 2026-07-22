"""G12 async run queue — job model, the queue contract, and the shared
per-user concurrency gate.

An office/flow run is executed DETACHED from the request that asked for it:
the servicer (or the G3 scheduler) creates the durable run row, enqueues a
Job, and returns immediately. A worker loop claims the job later and executes
it, writing results/STATE through the existing repos. Results are retrievable
via the office_runs / flow_runs rows (GetOfficeRun etc.).

Two backends implement the same contract:
  * InProcessQueue  — asyncio.Queue + a bounded worker pool. The default and
    the Redis-absent degrade path; identical to brain's prior in-process
    behaviour. Ephemeral: jobs live only in memory (at-most-once on crash).
  * RedisQueue      — a Redis list with a visibility-timeout lease so a
    crashed worker's job is redelivered (at-least-once), and a per-run lease
    so the same office never double-runs concurrently.

Law: boot degrades, never dies. No new REQUIRED env — with no REDIS_URL (or
the `redis` package absent) the queue is the in-process one. Tenant law: a Job
carries the OWNER user_id, set server-side at enqueue (never from a request
body); the worker uses only job.user_id for every repo call.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

# Reuse the single source of truth for the per-user office concurrency cap
# (v1 lesson). The queue is where it is now ENFORCED for detached runs.
from app.offices.runner import PER_USER_CONCURRENCY_CAP

# A handler executes one job to completion (persisting its own results/STATE).
Handler = Callable[["Job"], Awaitable[None]]


@dataclass(frozen=True)
class Job:
    """One unit of detached work. Fully serializable so it can cross a Redis
    boundary and survive a worker restart. Carries no provider object and no
    secret — the worker re-resolves the provider from user_id server-side."""

    kind: str                       # "office" | "flow"
    user_id: str                    # tenant OWNER (server-side; never a body)
    payload: dict                   # office: {office_id, run_id}; flow: {run_id, task, model}
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    attempts: int = 0

    @property
    def lease_id(self) -> str:
        """Key for the per-run single-flight lease. Office runs serialize per
        office (never two concurrent runs of the same office); flow runs are
        keyed per run (no contention) so a redelivery still de-dupes itself."""
        if self.kind == "office":
            return f"office:{self.payload.get('office_id', self.id)}"
        return f"{self.kind}:{self.payload.get('run_id', self.id)}"

    def to_json(self) -> str:
        return json.dumps(
            {
                "id": self.id,
                "kind": self.kind,
                "user_id": self.user_id,
                "payload": self.payload,
                "attempts": self.attempts,
            }
        )

    @classmethod
    def from_json(cls, raw: str) -> "Job":
        d = json.loads(raw)
        return cls(
            id=d["id"],
            kind=d["kind"],
            user_id=d["user_id"],
            payload=d.get("payload", {}),
            attempts=int(d.get("attempts", 0)),
        )

    def retry(self) -> "Job":
        return Job(
            kind=self.kind,
            user_id=self.user_id,
            payload=self.payload,
            id=self.id,
            attempts=self.attempts + 1,
        )


class UserGate:
    """Per-user concurrency cap, enforced worker-side. At most `cap`
    coroutines hold a given user's semaphore, so no user exceeds the cap of
    concurrent runs within this replica. (Cross-replica the cap is per-replica
    unless a Redis counter is layered on; the per-run lease still prevents any
    office from double-running across replicas.)"""

    def __init__(self, cap: int = PER_USER_CONCURRENCY_CAP) -> None:
        self._cap = max(1, cap)
        self._sems: dict[str, asyncio.Semaphore] = {}

    def semaphore(self, user_id: str) -> asyncio.Semaphore:
        return self._sems.setdefault(user_id, asyncio.Semaphore(self._cap))

    @property
    def cap(self) -> int:
        return self._cap


class JobQueue:
    """The queue contract shared by both backends."""

    backend = "abstract"

    async def enqueue(self, job: Job) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def start(self, handler: Handler) -> None:  # pragma: no cover
        raise NotImplementedError

    async def stop(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def health(self) -> dict:  # pragma: no cover - interface
        raise NotImplementedError


def now_monotonic() -> float:
    return time.monotonic()
