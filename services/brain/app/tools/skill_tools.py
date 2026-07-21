"""Skill-execution tool adapter.

A loaded skill (SKILL.md + scripts) becomes one callable tool. Calling it runs a
script through the EXISTING sandboxed executor — path-jail, network namespace,
env scrub, resource limits, timeout, and output cap all unchanged — so exposing
skills to the model adds no new execution surface. The script must live inside
the skill directory (the executor enforces this); the model can only pick a
script and its args.
"""

from __future__ import annotations

from app.skills.executor import SkillExecutionError, run_script
from app.skills.loader import Skill
from app.tenant import TenantCtx
from app.tools.base import Tool, ToolResult, prompt_safe, safe_name


class SkillToolAdapter(Tool):
    def __init__(self, skill: Skill):
        self._skill = skill
        self.name = safe_name("skill", skill.name)
        base = skill.description or f"the {skill.name} skill"
        self.description = (
            f"Run a script from {base}. Executes inside the skill's sandbox "
            "(no network, scrubbed env, resource-limited)."
        )
        self.parameters = {
            "type": "object",
            "properties": {
                "script": {
                    "type": "string",
                    "description": (
                        "Path to the script within the skill directory, "
                        "e.g. scripts/run.sh"
                    ),
                },
                "args": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Positional arguments passed to the script",
                },
            },
            "required": ["script"],
        }

    async def run(self, args: dict, tenant: TenantCtx) -> ToolResult:
        script = (args.get("script") or "").strip()
        if not script:
            return ToolResult(
                prompt_safe("no script specified", source=f"skill:{self._skill.name}"),
                is_error=True,
            )
        script_args = [str(a) for a in (args.get("args") or [])]
        try:
            result = await run_script(self._skill, script, script_args)
        except SkillExecutionError as exc:
            # Refusals (missing network isolation, path escape, timeout, output
            # cap) surface as a wrapped error the model can read but not obey.
            return ToolResult(
                prompt_safe(str(exc), source=f"skill:{self._skill.name}"),
                is_error=True,
            )
        # run_script output is already wrapUntrusted-wrapped + BOP-sanitized.
        return ToolResult(content=result.output, is_error=result.exit_code != 0)
