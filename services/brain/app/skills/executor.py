"""Sandboxed skill script execution.

Sandbox posture (Stage A, in-process service):
  - scripts must live inside the skill directory (path-jail, symlinks
    resolved before the check)
  - scrubbed environment (no service env/secrets leak into scripts)
  - skill directory as cwd, hard wall-clock timeout, output size cap
  - stdout/stderr are EXTERNAL CONTENT: BOP-sanitized and wrapped before
    they can enter any prompt
ponytail: OS-level isolation (container/user-namespace per execution) at
Stage C alongside mTLS.
"""

import asyncio
from dataclasses import dataclass
from pathlib import Path

from app.bop import sanitize_machinery
from app.skills.loader import Skill
from app.wrap import wrap_untrusted

MAX_OUTPUT_BYTES = 64 * 1024
SCRUBBED_ENV = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/tmp", "LANG": "C.UTF-8"}


class SkillExecutionError(RuntimeError):
    pass


@dataclass(frozen=True)
class SkillResult:
    exit_code: int
    output: str  # wrapped + sanitized, prompt-safe


def _jailed_script(skill: Skill, script_rel: str) -> Path:
    script = (skill.path / script_rel).resolve()
    if not script.is_relative_to(skill.path):
        raise SkillExecutionError(f"script escapes skill directory: {script_rel}")
    if not script.is_file():
        raise SkillExecutionError(f"no such script: {script_rel}")
    return script


async def run_script(
    skill: Skill, script_rel: str, args: list[str] | None = None, timeout: float = 30.0
) -> SkillResult:
    script = _jailed_script(skill, script_rel)
    proc = await asyncio.create_subprocess_exec(
        "/bin/sh", str(script), *(args or []),
        cwd=skill.path,
        env=SCRUBBED_ENV,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        raw, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise SkillExecutionError(f"script timed out after {timeout}s: {script_rel}")
    text = raw[:MAX_OUTPUT_BYTES].decode(errors="replace")
    return SkillResult(
        exit_code=proc.returncode or 0,
        output=wrap_untrusted(
            sanitize_machinery(text), source=f"skill:{skill.name}:{script_rel}"
        ),
    )
