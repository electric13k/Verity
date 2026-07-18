"""Skill loading — Claude Code plugin/skill format is Verity's NATIVE
format (plan §3): a skill is a directory with SKILL.md (YAML frontmatter:
name, description) plus optional scripts/assets; a plugin is a directory
with plugin.json and skills inside.

Skill instructions are external content: they enter prompts wrapped
(wrapUntrusted) so a hostile skill can't hijack orchestration.
"""

from dataclasses import dataclass
from pathlib import Path

from app.wrap import wrap_untrusted


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    path: Path
    instructions: str

    def prompt_context(self) -> str:
        """Skill instructions as (wrapped) prompt context."""
        return wrap_untrusted(self.instructions, source=f"skill:{self.name}")


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    meta: dict[str, str] = {}
    body = text
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end != -1:
            for line in text[4:end].splitlines():
                key, _, value = line.partition(":")
                if value:
                    meta[key.strip()] = value.strip().strip("\"'")
            body = text[end + 5 :]
    return meta, body.strip()


def load_skill(directory: str | Path) -> Skill | None:
    path = Path(directory)
    skill_md = path / "SKILL.md"
    if not skill_md.is_file():
        return None
    meta, body = _parse_frontmatter(skill_md.read_text())
    name = meta.get("name", path.name)
    return Skill(
        name=name,
        description=meta.get("description", ""),
        path=path.resolve(),
        instructions=body,
    )


def load_skills(root: str | Path) -> list[Skill]:
    """Loads every skill under root: direct skill dirs plus Claude-style
    plugins (plugin.json with skills/ inside)."""
    root = Path(root)
    if not root.is_dir():
        return []
    skills: list[Skill] = []
    for candidate in sorted(root.iterdir()):
        if not candidate.is_dir():
            continue
        if (skill := load_skill(candidate)) is not None:
            skills.append(skill)
        elif (candidate / "plugin.json").is_file():
            for sub in sorted((candidate / "skills").glob("*")):
                if (skill := load_skill(sub)) is not None:
                    skills.append(skill)
    return skills
