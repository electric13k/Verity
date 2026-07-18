"""Memory ("Brains"). cognee is the PRIMARY engine (self-hosted,
github.com/topoteretes/cognee; dataset-per-user isolation). The durable
FALLBACK is an Obsidian-compatible markdown vault (user decision
2026-07-18) — set OBSIDIAN_VAULT_PATH and every remembered fact becomes a
note you can open in Obsidian. Without either, an in-process store keeps
the pipeline (and its tests) honest.

Continuous learning: learn_from_exchange() runs after every chat/flow
exchange — the tag funnel + importance threshold decide what sticks.
"""

import logging
import re
from dataclasses import dataclass, field

import httpx

from app.config import settings

log = logging.getLogger("brain.memory")

IMPORTANCE_THRESHOLD = 0.3
_WORD = re.compile(r"[a-z0-9']+")


def _tokens(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


@dataclass
class MemoryItem:
    content: str
    scope: str = "main"
    tags: list[str] = field(default_factory=list)
    importance: float = 0.5


class InProcessStore:
    """Per-user isolated fallback store. Recall is token-overlap ranked —
    deliberately simple; cognee replaces it as primary when configured."""

    def __init__(self) -> None:
        self._items: dict[str, list[MemoryItem]] = {}

    async def add(self, user_id: str, item: MemoryItem) -> None:
        self._items.setdefault(user_id, []).append(item)

    async def search(self, user_id: str, scope: str, query: str, k: int) -> list[MemoryItem]:
        query_tokens = _tokens(query)
        if not query_tokens:
            return []
        candidates = [
            item for item in self._items.get(user_id, []) if item.scope == scope
        ]
        scored = [
            (len(query_tokens & _tokens(item.content)) * item.importance, item)
            for item in candidates
        ]
        scored = [(s, item) for s, item in scored if s > 0]
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [item for _, item in scored[:k]]


class CogneeStore:
    """cognee HTTP API. Dataset per user (isolation pattern from v1)."""

    def __init__(self, base_url: str, client: httpx.AsyncClient | None = None):
        self._base = base_url.rstrip("/")
        self._client = client or httpx.AsyncClient(timeout=30)

    def _dataset(self, user_id: str) -> str:
        return f"user_{user_id}"

    async def add(self, user_id: str, item: MemoryItem) -> None:
        await self._client.post(
            f"{self._base}/api/v1/add",
            json={"data": item.content, "datasetName": self._dataset(user_id)},
        )

    async def search(self, user_id: str, scope: str, query: str, k: int) -> list[MemoryItem]:
        resp = await self._client.post(
            f"{self._base}/api/v1/search",
            json={"query": query, "datasetName": self._dataset(user_id), "topK": k},
        )
        resp.raise_for_status()
        results = resp.json() if isinstance(resp.json(), list) else []
        return [MemoryItem(content=str(r)) for r in results[:k]]


class MemoryService:
    def __init__(self) -> None:
        if settings.obsidian_vault_path:
            from app.memory.obsidian import ObsidianStore

            self._fallback = ObsidianStore(settings.obsidian_vault_path)
        else:
            self._fallback = InProcessStore()
        self._cognee: CogneeStore | None = (
            CogneeStore(settings.cognee_url) if settings.cognee_url else None
        )

    @property
    def _primary(self):
        return self._cognee or self._fallback

    async def recall(self, user_id: str, query: str, scope: str = "main", k: int = 5) -> list[str]:
        try:
            items = await self._primary.search(user_id, scope, query, k)
        except Exception as exc:  # degrade to fallback, never fail the chat
            log.warning("primary memory recall failed (%s); using fallback", exc)
            items = await self._fallback.search(user_id, scope, query, k)
        return [item.content for item in items]

    async def learn_from_exchange(
        self, user_id: str, user_msg: str, assistant_msg: str, scope: str = "main"
    ) -> bool:
        """Tag funnel + importance threshold; returns True if stored."""
        importance = rate_importance(user_msg, assistant_msg)
        if importance < IMPORTANCE_THRESHOLD:
            return False
        item = MemoryItem(
            content=f"User asked: {user_msg[:500]} — Assistant concluded: {assistant_msg[:1000]}",
            scope=scope,
            tags=sorted(_tokens(user_msg))[:8],
            importance=importance,
        )
        try:
            await self._primary.add(user_id, item)
        except Exception as exc:
            log.warning("primary memory write failed (%s); using fallback", exc)
            await self._fallback.add(user_id, item)
        return True


def rate_importance(user_msg: str, assistant_msg: str) -> float:
    """Heuristic importance: durable facts/preferences score high, small
    talk scores low. LLM-assisted extraction (swarm-routed) lands with the
    full learning loop."""
    score = 0.3
    lowered = user_msg.lower()
    if any(
        kw in lowered
        for kw in ("my name", "i prefer", "always", "never", "remember", "i work", "i live", "call me")
    ):
        score += 0.4
    if len(user_msg) > 200:
        score += 0.1
    if len(assistant_msg) > 400:
        score += 0.1
    if len(user_msg.split()) < 3:
        score -= 0.2
    return max(0.0, min(1.0, score))


memory_service = MemoryService()
