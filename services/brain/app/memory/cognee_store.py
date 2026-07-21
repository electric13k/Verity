"""cognee as the PRIMARY, in-process knowledge-graph memory engine.

Built against the cognee library API (github.com/topoteretes/cognee,
``cognee/api/v1``; confirmed on cognee 1.x):

    import cognee
    await cognee.add(text, dataset_name=...)      # ingest raw text
    await cognee.cognify(datasets=[...])          # build the knowledge graph  <-- the point
    await cognee.search(                          # retrieve
        query_text=..., query_type=cognee.SearchType.CHUNKS, datasets=[...], top_k=k,
    )

``SearchType`` is exported at ``cognee.SearchType`` (source:
``cognee.modules.search.types``). ``cognee.add`` takes ``dataset_name`` and
``cognee.search`` takes ``datasets`` — that pair is how we enforce
**dataset-per-user isolation**: the dataset name is keyed by the caller's
user_id (and scope), so one user's graph is never inside another user's search
scope. This is the tenant law (identity from metadata, never a body field)
applied to memory.

cognee is an OPTIONAL extra (``pyproject`` ``[project.optional-dependencies]``
``cognee``). Nothing here is imported at module top; ``cognee`` is imported
lazily inside the constructor. If it is not installed, or cannot initialise,
the constructor raises ``CogneeUnavailable`` and ``MemoryService`` selects a
lighter store (Obsidian vault, then in-process) — the brain boots degraded,
never dies. Runtime failures (e.g. no embedding/LLM model available) raise out
of add/search and ``MemoryService`` degrades that single call to the fallback
store.
"""

import logging

from app.config import settings
from app.memory.service import MemoryItem

log = logging.getLogger("brain.memory.cognee")

# Retrieval search type: returns matching text chunks (data to inject as
# memory context), not an LLM-synthesised answer — cheaper and exactly the
# "wrapped-untrusted-ready strings" recall() must return. Falls back to
# GRAPH_COMPLETION if a cognee build ever drops CHUNKS.
_PREFERRED_SEARCH_TYPE = "CHUNKS"


class CogneeUnavailable(RuntimeError):
    """cognee is not installed or could not initialise; caller degrades."""


def _stringify(result) -> str:
    """Normalise one cognee search result to text. Results vary by SearchType
    and version (str, dict, or object), so probe defensively."""
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        for key in ("text", "content", "chunk", "value", "answer", "name"):
            value = result.get(key)
            if value:
                return str(value)
        return str(result)
    for attr in ("text", "content", "answer", "payload"):
        value = getattr(result, attr, None)
        if value:
            return str(value)
    return str(result)


class CogneeLibraryStore:
    """Primary memory store backed by the in-process cognee library.

    Same async surface as InProcessStore / ObsidianStore (add / search) so
    MemoryService treats every backend uniformly.

    ``module`` is injectable for tests so the add→cognify→search wiring can be
    exercised without installing cognee or downloading models; in production it
    is left None and the real library is imported lazily.
    """

    def __init__(self, module=None) -> None:
        if module is None:
            try:
                import cognee as module  # lazy: never imported at app boot
            except Exception as exc:  # ImportError or transitive import failure
                raise CogneeUnavailable(f"cognee not importable: {exc}") from exc
        self._cognee = module
        try:
            self._search_type = getattr(
                module.SearchType, _PREFERRED_SEARCH_TYPE, module.SearchType.GRAPH_COMPLETION
            )
            self._configure(module)
        except CogneeUnavailable:
            raise
        except Exception as exc:  # bad config → degrade at selection, not at boot-crash
            raise CogneeUnavailable(f"cognee init failed: {exc}") from exc

    def _configure(self, cognee) -> None:
        """Point cognee at its storage dir and (optionally) the user's LLM.

        Every step is optional: cognee also reads its own ``LLM_*`` env. Secrets
        (the api key) are handed to cognee but never logged.
        """
        config = getattr(cognee, "config", None)
        if config is None:
            return
        if settings.cognee_data_dir:
            # system_root cascades to relational/graph/vector paths; data_root
            # holds ingested source data. Keep the graph off shared temp dirs.
            if hasattr(config, "system_root_directory"):
                config.system_root_directory(settings.cognee_data_dir)
            if hasattr(config, "data_root_directory"):
                config.data_root_directory(settings.cognee_data_dir)
        if settings.cognee_llm_provider and hasattr(config, "set_llm_provider"):
            config.set_llm_provider(settings.cognee_llm_provider)
        if settings.cognee_llm_model and hasattr(config, "set_llm_model"):
            config.set_llm_model(settings.cognee_llm_model)
        if settings.cognee_llm_api_key and hasattr(config, "set_llm_api_key"):
            config.set_llm_api_key(settings.cognee_llm_api_key)  # secret: never logged
        log.info(
            "cognee configured (data_dir=%s llm_provider=%s)",
            bool(settings.cognee_data_dir), settings.cognee_llm_provider or "<env>",
        )

    def _dataset(self, user_id: str, scope: str) -> str:
        """Dataset per (user, scope). Isolation boundary: search is always
        pinned to exactly this dataset, so cross-tenant recall is impossible."""
        safe_user = _safe(user_id)
        safe_scope = _safe(scope)
        return f"user_{safe_user}__{safe_scope}"

    async def add(self, user_id: str, item: MemoryItem) -> None:
        """Ingest a memory then rebuild its graph — add → cognify."""
        dataset = self._dataset(user_id, item.scope)
        await self._cognee.add(item.content, dataset_name=dataset)
        # cognify is the whole point of cognee: it turns the raw text into a
        # knowledge graph. Scoped to this user's dataset only.
        await self._cognee.cognify(datasets=[dataset])

    async def search(
        self, user_id: str, scope: str, query: str, k: int
    ) -> list[MemoryItem]:
        dataset = self._dataset(user_id, scope)
        results = await self._cognee.search(
            query_text=query,
            query_type=self._search_type,
            datasets=[dataset],  # tenant isolation: never another user's dataset
            top_k=k,
        )
        items: list[MemoryItem] = []
        for result in list(results or [])[:k]:
            text = _stringify(result).strip()
            if text:
                items.append(MemoryItem(content=text, scope=scope))
        return items


def _safe(text: str) -> str:
    """Dataset-name-safe token: cognee dataset names key the isolation
    boundary, so keep them to a predictable charset."""
    return "".join(c if c.isalnum() else "_" for c in (text or "").lower())[:64] or "anon"
