"""Offices — scheduled flows with decomposition, STATE.md checkpointing,
and the autonomy preamble (v1 scaled-CAHSI port, data-driven).

An office is a JSON definition (name, task, schedule, flow_kind, model).
Each run executes the flow engine and checkpoints STATE.md after every
phase, so a crashed run can be inspected and resumed by the next tick.
Per-user concurrency caps (v1 lesson) stop runaway schedules.
"""

import asyncio
import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import BaseModel, Field

from app.flows.engine import run_flow
from app.providers.base import Provider

AUTONOMY_PREAMBLE = (
    "This task runs unattended. Make reasonable decisions without asking; "
    "record every decision and its rationale in your output. Stop only for "
    "destructive or irreversible actions."
)

PER_USER_CONCURRENCY_CAP = 2


class OfficeDefinition(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    task: str = Field(min_length=1)
    schedule: str = ""            # cron expression; empty = manual runs only
    flow_kind: str = ""           # empty = auto-pick
    model: str = ""               # provider:model; empty = default
    workers: int = Field(default=2, ge=1, le=4)


def load_offices(directory: str | Path) -> list[OfficeDefinition]:
    """Offices are data: one JSON file per office in OFFICES_PATH."""
    root = Path(directory)
    if not root.is_dir():
        return []
    offices = []
    for path in sorted(root.glob("*.json")):
        offices.append(
            OfficeDefinition.model_validate(json.loads(path.read_text(encoding="utf-8")))
        )
    return offices


@dataclass
class OfficeRun:
    office: OfficeDefinition
    user_id: str
    state_dir: Path
    phases: list[tuple[str, str, str]] = field(default_factory=list)
    status: str = "pending"

    @property
    def state_path(self) -> Path:
        return self.state_dir / "STATE.md"

    def checkpoint(self) -> None:
        lines = [
            f"# {self.office.name} — STATE",
            "",
            f"status: {self.status}",
            f"updated: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
            "",
            "## Autonomy",
            AUTONOMY_PREAMBLE,
            "",
            "## Task",
            self.office.task,
            "",
            "## Phases",
        ]
        for role, phase, content in self.phases:
            lines += [f"### {phase} ({role})", content or "(no output)", ""]
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text("\n".join(lines), encoding="utf-8")


class OfficeRunner:
    """Executes offices with per-user concurrency caps."""

    def __init__(self, state_root: str | Path):
        self._state_root = Path(state_root)
        self._semaphores: dict[str, asyncio.Semaphore] = {}

    def _semaphore(self, user_id: str) -> asyncio.Semaphore:
        return self._semaphores.setdefault(
            user_id, asyncio.Semaphore(PER_USER_CONCURRENCY_CAP)
        )

    def _run_dir(self, user_id: str, office: OfficeDefinition) -> Path:
        stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in office.name)
        safe_user = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in user_id)
        return self._state_root / f"user_{safe_user}" / safe / stamp

    async def run(
        self, office: OfficeDefinition, user_id: str, provider: Provider, model: str
    ) -> OfficeRun:
        run = OfficeRun(office=office, user_id=user_id,
                        state_dir=self._run_dir(user_id, office))
        async with self._semaphore(user_id):
            run.status = "running"
            run.checkpoint()
            try:
                task = f"{AUTONOMY_PREAMBLE}\n\nTask: {office.task}"
                async for event in run_flow(
                    provider, model, task,
                    flow_kind=office.flow_kind, workers=office.workers,
                ):
                    run.phases.append((event.role, event.phase, event.content))
                    run.checkpoint()  # checkpoint after every phase
                run.status = "done"
            except Exception as exc:
                run.phases.append(("office", "error", str(exc)))
                run.status = "failed"
            run.checkpoint()
        return run
