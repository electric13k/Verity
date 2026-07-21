"""Knowledge base backend — grounded RAG over user-ingested documents.

Distinct from auto-learned memory (memory/service.py). Memory captures facts
the learning loop decides are durable; the KB is documents the user (or the
future Brain-Garden UI) explicitly ingests and wants grounded retrieval over.
They share the same backend precedence (cognee library → remote cognee →
Obsidian/in-process) but live in DIFFERENT datasets, so KB retrieval and memory
recall never bleed into each other.

Tenant + project isolation (the tenant law applied to RAG):
  * ``user_id`` comes only from gRPC metadata (never a body/tool field);
  * the vector dataset is keyed ``kb__{project}`` PER USER — cognee's
    dataset-per-user isolation means a search is pinned to exactly one
    (user, project) dataset, so cross-tenant / cross-project retrieval is
    impossible. The cross-tenant test proves an ingest by user A yields nothing
    for user B.

Doc metadata (the list/add/delete the UI needs) is a per-user on-disk JSON
index — no new DB table (hence no migration in this territory), tenant-scoped by
directory, degrade-friendly. Boot degrades, never dies: with no cognee the KB
still ingests + searches through the in-process fallback.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.config import settings
from app.memory.service import MemoryItem, build_fallback_store, select_primary_store

log = logging.getLogger("brain.kb")

_SAFE = re.compile(r"[^a-zA-Z0-9_-]")
_CHUNK_CHARS = 1200
_MAX_CHUNKS_PER_DOC = 400
_DEFAULT_PROJECT = "default"


def _safe(text: str) -> str:
    return _SAFE.sub("_", (text or "").lower())[:64] or _DEFAULT_PROJECT


def kb_scope(project: str | None) -> str:
    """Dataset scope for a project's KB — namespaced away from memory's
    'main'/project scopes so the two never collide inside one user's store."""
    return f"kb__{_safe(project or _DEFAULT_PROJECT)}"


def chunk_text(text: str, size: int = _CHUNK_CHARS) -> list[str]:
    """Split into ~size-char chunks on paragraph then sentence boundaries."""
    text = text.strip()
    if not text:
        return []
    paras = re.split(r"\n\s*\n", text)
    chunks: list[str] = []
    buf = ""
    for para in paras:
        para = para.strip()
        if not para:
            continue
        if len(buf) + len(para) + 2 <= size:
            buf = f"{buf}\n\n{para}" if buf else para
            continue
        if buf:
            chunks.append(buf)
            buf = ""
        if len(para) <= size:
            buf = para
        else:  # hard-split an oversized paragraph
            for i in range(0, len(para), size):
                chunks.append(para[i : i + size])
    if buf:
        chunks.append(buf)
    return chunks[:_MAX_CHUNKS_PER_DOC]


@dataclass(frozen=True)
class KBDoc:
    id: str
    name: str
    project: str
    chunks: int
    byte_size: int
    created_at: str


class KBIndex:
    """Per-user on-disk doc registry (list/add/delete for the UI). Tenant-scoped
    by directory; identity is the caller's user_id from metadata only."""

    def __init__(self, root: str | None = None):
        self._root = Path(
            root or settings.kb_dir or os.path.join(tempfile.gettempdir(), "verity-kb")
        )

    def _path(self, user_id: str) -> Path:
        return self._root / f"user_{_safe(user_id)}" / "index.json"

    def _load(self, user_id: str) -> list[dict]:
        path = self._path(user_id)
        if not path.is_file():
            return []
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data.get("docs", []) if isinstance(data, dict) else []
        except Exception as exc:
            log.warning("kb index read failed: %s", exc)
            return []

    def _save(self, user_id: str, docs: list[dict]) -> None:
        path = self._path(user_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"docs": docs}), encoding="utf-8")

    def add(self, user_id: str, doc: KBDoc) -> None:
        docs = self._load(user_id)
        docs.append(doc.__dict__)
        self._save(user_id, docs)

    def list(self, user_id: str, project: str | None = None) -> list[KBDoc]:
        docs = self._load(user_id)
        proj = _safe(project) if project else None
        return [
            KBDoc(**d)
            for d in docs
            if proj is None or _safe(d.get("project", "")) == proj
        ]

    def remove(self, user_id: str, doc_id: str) -> KBDoc | None:
        docs = self._load(user_id)
        kept, removed = [], None
        for d in docs:
            if d.get("id") == doc_id:
                removed = KBDoc(**d)
            else:
                kept.append(d)
        if removed is not None:
            self._save(user_id, kept)
        return removed


class KBService:
    """Ingest + grounded search over per-(user, project) datasets.

    Shares memory's backend precedence but uses KB-scoped datasets, so KB
    content is isolated from auto-learned facts. Every method takes ``user_id``
    (from gRPC metadata) and pins the dataset to it — fail-closed cross-tenant.
    """

    def __init__(self, index_root: str | None = None):
        self._fallback = build_fallback_store()
        self._primary_store = select_primary_store()
        self._index = KBIndex(index_root)

    @property
    def _primary(self):
        return self._primary_store or self._fallback

    async def ingest(
        self, user_id: str, name: str, content: str, project: str | None = None
    ) -> KBDoc:
        """Chunk + embed a document into this (user, project) dataset."""
        scope = kb_scope(project)
        chunks = chunk_text(content)
        stored = 0
        for chunk in chunks:
            item = MemoryItem(content=chunk, scope=scope, importance=1.0)
            try:
                await self._primary.add(user_id, item)
            except Exception as exc:  # degrade this chunk to the fallback store
                log.warning("kb primary add failed (%s); using fallback", exc)
                await self._fallback.add(user_id, item)
            stored += 1
        doc = KBDoc(
            id=uuid.uuid4().hex,
            name=name or "document",
            project=_safe(project) if project else _DEFAULT_PROJECT,
            chunks=stored,
            byte_size=len(content.encode()),
            created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
        self._index.add(user_id, doc)
        log.info(
            "kb ingest user=%s project=%s chunks=%d", user_id, doc.project, stored
        )
        return doc

    async def search(
        self, user_id: str, query: str, project: str | None = None, k: int = 5
    ) -> list[str]:
        """Grounded retrieval, pinned to (user, project) — fail-closed."""
        scope = kb_scope(project)
        try:
            items = await self._primary.search(user_id, scope, query, k)
        except Exception as exc:  # degrade to fallback, never fail the tool
            log.warning("kb primary search failed (%s); using fallback", exc)
            items = await self._fallback.search(user_id, scope, query, k)
        return [item.content for item in items]

    def list_docs(self, user_id: str, project: str | None = None) -> list[KBDoc]:
        return self._index.list(user_id, project)

    def delete_doc(self, user_id: str, doc_id: str) -> KBDoc | None:
        """Remove a doc from the tenant's index. (Vector chunks are pruned by
        the store's own retention; the index is the UI source of truth.)"""
        return self._index.remove(user_id, doc_id)


kb_service = KBService()
