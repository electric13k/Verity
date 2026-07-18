"""Obsidian-compatible markdown vault — the durable fallback brain store.

Decision (user, 2026-07-18): cognee (self-hosted, github.com/topoteretes/
cognee) is the primary memory engine; when it isn't available the brain
falls back to an Obsidian vault — plain markdown notes with YAML
frontmatter, one note per memory, so the whole brain can be opened,
browsed, and edited directly in Obsidian.

Layout (per-user isolation is directory-level):
    <vault>/user_<id>/<scope>/<timestamp>-<slug>.md
"""

import re
import time
from pathlib import Path

from app.memory.service import MemoryItem, _tokens

_SLUG = re.compile(r"[^a-z0-9]+")


def _slugify(text: str, max_len: int = 40) -> str:
    return _SLUG.sub("-", text.lower()).strip("-")[:max_len] or "memory"


def _frontmatter(item: MemoryItem) -> str:
    tags = ", ".join(item.tags)
    return (
        "---\n"
        f"scope: {item.scope}\n"
        f"tags: [{tags}]\n"
        f"importance: {item.importance:.2f}\n"
        f"created: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n"
        "---\n"
    )


def _parse(text: str) -> tuple[dict, str]:
    """Split a note into (frontmatter dict, body). Tolerant of hand edits."""
    meta: dict[str, str] = {}
    body = text
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end != -1:
            for line in text[4:end].splitlines():
                key, _, value = line.partition(":")
                if value:
                    meta[key.strip()] = value.strip()
            body = text[end + 5 :]
    return meta, body.strip()


class ObsidianStore:
    def __init__(self, root: str | Path) -> None:
        self._root = Path(root)

    def _user_dir(self, user_id: str, scope: str) -> Path:
        # Sanitize both components: they become filesystem paths and must
        # never traverse outside the vault.
        safe_user = _slugify(user_id, 64)
        safe_scope = _slugify(scope, 64)
        return self._root / f"user_{safe_user}" / safe_scope

    async def add(self, user_id: str, item: MemoryItem) -> None:
        directory = self._user_dir(user_id, item.scope)
        directory.mkdir(parents=True, exist_ok=True)
        name = f"{int(time.time() * 1000)}-{_slugify(item.content)}.md"
        (directory / name).write_text(_frontmatter(item) + item.content + "\n")

    async def search(self, user_id: str, scope: str, query: str, k: int) -> list[MemoryItem]:
        directory = self._user_dir(user_id, scope)
        if not directory.is_dir():
            return []
        query_tokens = _tokens(query)
        if not query_tokens:
            return []
        scored: list[tuple[float, MemoryItem]] = []
        for note in directory.glob("*.md"):
            meta, body = _parse(note.read_text())
            try:
                importance = float(meta.get("importance", 0.5))
            except ValueError:
                importance = 0.5
            overlap = len(query_tokens & _tokens(body))
            if overlap:
                scored.append(
                    (overlap * importance, MemoryItem(content=body, scope=scope, importance=importance))
                )
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [item for _, item in scored[:k]]
