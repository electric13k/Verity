"""Data-driven flow engine — the v1 conductor/worker/inspector architecture
as flow definitions, not code paths.

Phases: plan (conductor decomposes) → work (N workers, parallel) → verify
(inspector) → converge (final synthesis). "diverge_converge" runs workers
on the SAME task with different angles then converges (CAAI); "converge"
splits into subtasks. Auto-pick: multi-part tasks get "converge",
open-ended ones get "diverge_converge".

BOP: role preambles are machinery and never appear in another role's input
or in emitted events; worker outputs are sanitized before crossing back.
"""

import asyncio
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass

from app.bop import sanitize_machinery
from app.providers.base import ChatMessage, Delta, Provider

MAX_WORKERS = 4
DEFAULT_WORKERS = 2

CONDUCTOR_PREAMBLE = (
    "Decompose the task into at most {n} independent subtasks, one per line, "
    "numbered. Output only the numbered subtasks."
)
WORKER_PREAMBLE = (
    "Complete this subtask thoroughly. Output only the work product, no "
    "commentary about the process."
)
DIVERGE_ANGLES = [
    "Approach the task directly and pragmatically.",
    "Approach the task from first principles; challenge assumptions.",
    "Approach the task adversarially: what could go wrong or be missing?",
    "Approach the task from the user's perspective: what would serve them best?",
]
INSPECTOR_PREAMBLE = (
    "You are reviewing work products for the given task. Identify concrete "
    "errors, contradictions, or gaps. If the work is sound, say APPROVED and "
    "why in one line."
)
CONVERGE_PREAMBLE = (
    "Merge the work products into one final, coherent answer to the task. "
    "Resolve conflicts explicitly. Output only the final answer."
)


@dataclass(frozen=True)
class FlowEvent:
    role: str    # conductor | worker-<n> | inspector | flow
    phase: str   # plan | work | verify | converge | done | error
    content: str


def pick_flow_kind(task: str) -> str:
    multi_part = bool(
        re.search(r"\b(and|then|also|steps?|plus)\b", task, re.I)
    ) or task.count("?") > 1
    return "converge" if multi_part else "diverge_converge"


def parse_subtasks(plan: str, cap: int) -> list[str]:
    subtasks = [
        m.group(2).strip()
        for m in re.finditer(r"^\s*(\d+)[.)]\s+(.+)$", plan, re.M)
    ]
    return subtasks[:cap] or [plan.strip()]


async def _complete(provider: Provider, model: str, preamble: str, content: str) -> str:
    """One non-streamed role turn. Role preambles ride in the system slot —
    they are machinery and never enter another role's user-visible input."""
    parts: list[str] = []
    async for event in provider.stream_chat(
        [ChatMessage("system", preamble), ChatMessage("user", content)], model
    ):
        if isinstance(event, Delta):
            parts.append(event.text)
    return "".join(parts)


async def run_flow(
    provider: Provider,
    model: str,
    task: str,
    flow_kind: str = "",
    workers: int = 0,
) -> AsyncIterator[FlowEvent]:
    kind = flow_kind or pick_flow_kind(task)
    n_workers = min(MAX_WORKERS, workers or DEFAULT_WORKERS)

    # plan
    if kind == "converge":
        plan = await _complete(
            provider, model, CONDUCTOR_PREAMBLE.format(n=n_workers), task
        )
        subtasks = parse_subtasks(plan, n_workers)
    else:  # diverge_converge: same task, different angles
        subtasks = [task] * n_workers
    yield FlowEvent("conductor", "plan", sanitize_machinery("\n".join(
        f"{i + 1}. {s}" if kind == "converge" else f"{i + 1}. angle {i + 1}"
        for i, s in enumerate(subtasks)
    )))

    # work (parallel)
    async def work(i: int, subtask: str) -> str:
        preamble = WORKER_PREAMBLE
        if kind == "diverge_converge":
            preamble += " " + DIVERGE_ANGLES[i % len(DIVERGE_ANGLES)]
        return await _complete(provider, model, preamble, subtask)

    results = await asyncio.gather(
        *(work(i, s) for i, s in enumerate(subtasks)), return_exceptions=True
    )
    products: list[str] = []
    for i, result in enumerate(results):
        if isinstance(result, BaseException):
            yield FlowEvent(f"worker-{i + 1}", "error", str(result))
            continue
        clean = sanitize_machinery(result)
        products.append(clean)
        yield FlowEvent(f"worker-{i + 1}", "work", clean)
    if not products:
        yield FlowEvent("flow", "error", "all workers failed")
        return

    # verify
    merged = "\n\n---\n\n".join(products)
    verdict = await _complete(
        provider, model, INSPECTOR_PREAMBLE, f"Task: {task}\n\nWork products:\n{merged}"
    )
    yield FlowEvent("inspector", "verify", sanitize_machinery(verdict))

    # converge
    final = await _complete(
        provider, model, CONVERGE_PREAMBLE, f"Task: {task}\n\nWork products:\n{merged}"
    )
    yield FlowEvent("flow", "converge", sanitize_machinery(final))
    yield FlowEvent("flow", "done", "")
