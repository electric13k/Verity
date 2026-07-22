"""Job handlers — how a claimed Job actually runs.

The worker (either backend) calls ``dispatch(job)``. Dispatch routes by
``job.kind`` and executes the run using the SAME flow/office machinery the
request path used before G12, then persists the result through the existing
repos. Kept free of any gRPC/servicer import so ``app.queue`` never imports
``platform_server`` (which imports the queue) — no cycle.

Laws honoured here:
  * Tenant law — every repo call uses ``job.user_id`` (the office's stored
    owner, set server-side at enqueue), never a request body. The office/flow
    is re-resolved from that owner's vaulted provider key.
  * BOP / wrapUntrusted — office STATE and flow events are produced by the
    flow engine, which sanitizes machinery exactly as before; nothing new
    leaks. No secret is placed in a Job or a log.
  * Degrade, never die — a handler exception is caught and recorded as a
    failed run; it never kills the worker.
"""

from __future__ import annotations

import logging
import os
import tempfile

from app.flows.engine import run_flow
from app.offices.runner import OfficeDefinition, OfficeRunner
from app.providers import registry
from app.queue.base import Job
from app.repos import branches as branches_repo
from app.repos import offices as offices_repo

log = logging.getLogger("brain.queue")


def _office_state_root() -> str:
    return os.environ.get(
        "VERITY_OFFICE_STATE_PATH", os.path.join(tempfile.gettempdir(), "verity-offices")
    )


# One runner for the whole process (its per-user semaphores are a second, local
# guard; the queue's UserGate is the primary cap for detached runs).
_office_runner = OfficeRunner(state_root=_office_state_root())


async def _handle_office(job: Job) -> None:
    user_id = job.user_id
    office_id = job.payload["office_id"]
    run_id = job.payload["run_id"]
    try:
        office = await offices_repo.get(user_id, office_id)
        if office is None:
            await offices_repo.finish_run(user_id, run_id, "failed", "office not found")
            return
        d = office.definition or {}
        provider, model = await registry.resolve_for_user(d.get("model", ""), user_id)
        definition = OfficeDefinition(
            name=office.name,
            task=d.get("task", office.name),
            schedule=office.schedule_cron,
            flow_kind=d.get("flow_kind", ""),
            model=d.get("model", ""),
            workers=int(d.get("workers", 2)),
        )
        run = await _office_runner.run(definition, user_id, provider, model)
        state_md = (
            run.state_path.read_text(encoding="utf-8") if run.state_path.exists() else ""
        )
        await offices_repo.finish_run(user_id, run_id, run.status, state_md)
    except Exception as exc:  # background: never crash the worker loop
        log.warning("office run %s failed: %s", run_id, exc)
        try:
            await offices_repo.finish_run(user_id, run_id, "failed", f"error: {exc}")
        except Exception:
            pass
        raise  # let the queue count the attempt (Redis redelivers; in-proc drops)


async def _handle_flow(job: Job) -> None:
    user_id = job.user_id
    run_id = job.payload["run_id"]
    task = job.payload["task"]
    selector = job.payload.get("model", "")
    final = ""
    phases: list[dict] = []
    try:
        provider, model = await registry.resolve_for_user(selector, user_id)
        async for event in run_flow(provider, model, task):
            phases.append(
                {"role": event.role, "phase": event.phase, "content": event.content}
            )
            if event.phase == "converge":
                final = event.content
        await branches_repo.finish_flow_run(
            user_id, run_id, "done", {"phases": phases, "final": final}
        )
    except Exception as exc:
        log.warning("flow run %s failed: %s", run_id, exc)
        try:
            await branches_repo.finish_flow_run(
                user_id, run_id, "failed", {"error": str(exc)}
            )
        except Exception:
            pass
        raise


async def dispatch(job: Job) -> None:
    """Route a claimed job to its handler."""
    if job.kind == "office":
        await _handle_office(job)
    elif job.kind == "flow":
        await _handle_flow(job)
    else:
        log.warning("unknown job kind %r; dropping", job.kind)
