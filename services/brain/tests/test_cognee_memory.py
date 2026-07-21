"""cognee as primary memory engine: mocked add→cognify→search lifecycle,
dataset-per-user isolation, and degrade-never-die selection.

cognee is an optional extra and is NOT installed in the default test env, so
the real library is never imported here; a fake module exercises the wiring
(the same shape as cognee's confirmed 1.x API: add(dataset_name=...),
cognify(datasets=[...]), search(query_text, query_type, datasets, top_k),
SearchType). The selection tests prove the brain boots to a lighter store when
cognee is off or unavailable.
"""

import app.memory.cognee_store as cs
from app.config import settings
from app.memory.cognee_store import CogneeLibraryStore, CogneeUnavailable
from app.memory.obsidian import ObsidianStore
from app.memory.service import InProcessStore, MemoryItem, MemoryService


# --- fake cognee library -------------------------------------------------

class _FakeSearchType:
    CHUNKS = "CHUNKS"
    GRAPH_COMPLETION = "GRAPH_COMPLETION"


class _FakeConfig:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def system_root_directory(self, path): self.calls.append(("system_root", path))
    def data_root_directory(self, path): self.calls.append(("data_root", path))
    def set_llm_provider(self, p): self.calls.append(("provider", p))
    def set_llm_model(self, m): self.calls.append(("model", m))
    def set_llm_api_key(self, k): self.calls.append(("api_key", k))


class FakeCognee:
    """Records the lifecycle and honours dataset scoping so isolation is real:
    search only ever returns chunks from the datasets it is handed."""

    SearchType = _FakeSearchType

    def __init__(self) -> None:
        self.config = _FakeConfig()
        self.store: dict[str, list[str]] = {}
        self.added: list[tuple[str, str]] = []
        self.cognified: list[tuple[str, ...]] = []

    async def add(self, data, dataset_name="main_dataset", **kw):
        self.added.append((dataset_name, data))
        self.store.setdefault(dataset_name, []).append(data)

    async def cognify(self, datasets=None, **kw):
        self.cognified.append(tuple(datasets or []))

    async def search(self, query_text, query_type=None, datasets=None, top_k=15, **kw):
        out: list[str] = []
        for ds in datasets or []:
            out.extend(self.store.get(ds, []))
        return out[:top_k]


# --- lifecycle: add → cognify → search -----------------------------------

async def test_cognee_lifecycle_add_cognify_search():
    fake = FakeCognee()
    store = CogneeLibraryStore(module=fake)
    dataset = store._dataset("user_a", "main")

    await store.add("user_a", MemoryItem(content="user a loves rust", scope="main"))

    # add ingested, then cognify built the graph — both scoped to the user's dataset.
    assert fake.added == [(dataset, "user a loves rust")]
    assert fake.cognified == [(dataset,)]

    hits = await store.search("user_a", "main", "rust", 5)
    assert any("rust" in h.content for h in hits)


async def test_cognee_search_pins_the_user_dataset():
    """search must always target exactly the caller's dataset."""
    fake = FakeCognee()
    store = CogneeLibraryStore(module=fake)
    seen: dict = {}

    async def spy_search(query_text, query_type=None, datasets=None, top_k=15, **kw):
        seen["datasets"] = datasets
        seen["query_type"] = query_type
        return []

    fake.search = spy_search
    await store.search("user_z", "project", "anything", 3)
    assert seen["datasets"] == [store._dataset("user_z", "project")]
    assert seen["query_type"] == _FakeSearchType.CHUNKS  # retrieval, not LLM completion


# --- dataset-per-user isolation ------------------------------------------

async def test_cognee_dataset_isolation_store_level():
    fake = FakeCognee()
    store = CogneeLibraryStore(module=fake)
    await store.add("user_a", MemoryItem(content="user a secret fact", scope="main"))
    # A different user's recall hits a different dataset → nothing.
    assert await store.search("user_b", "main", "secret fact", 5) == []


async def test_cognee_recall_isolation_via_service():
    """Wrong-user recall through MemoryService returns nothing (tenant law)."""
    fake = FakeCognee()
    service = MemoryService()
    service._primary_store = CogneeLibraryStore(module=fake)

    stored = await service.learn_from_exchange(
        "user_a", "Remember I prefer metric units always", "Noted — metric units."
    )
    assert stored  # importance-gated write went through the cognee path
    assert fake.added and fake.cognified  # add + cognify both fired

    mine = await service.recall("user_a", "which units do I prefer? metric?")
    assert any("metric" in m for m in mine)

    theirs = await service.recall("user_b", "which units do I prefer? metric?")
    assert theirs == []  # cross-tenant recall is impossible


# --- LLM / storage passthrough -------------------------------------------

async def test_cognee_configures_llm_and_storage(monkeypatch):
    monkeypatch.setattr(settings, "cognee_data_dir", "/tmp/verity-cognee-test")
    monkeypatch.setattr(settings, "cognee_llm_provider", "openai")
    monkeypatch.setattr(settings, "cognee_llm_model", "gpt-4o-mini")
    monkeypatch.setattr(settings, "cognee_llm_api_key", "sk-not-a-real-key")
    fake = FakeCognee()
    CogneeLibraryStore(module=fake)
    kinds = {kind for kind, _ in fake.config.calls}
    assert {"system_root", "data_root", "provider", "model", "api_key"} <= kinds


# --- degrade-never-die selection -----------------------------------------

def test_disabled_cognee_degrades_to_inprocess(monkeypatch):
    monkeypatch.setattr(settings, "cognee_enabled", False)
    monkeypatch.setattr(settings, "cognee_url", None)
    monkeypatch.setattr(settings, "obsidian_vault_path", None)
    service = MemoryService()
    assert service._primary_store is None
    assert isinstance(service._fallback, InProcessStore)


def test_disabled_cognee_degrades_to_obsidian(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "cognee_enabled", False)
    monkeypatch.setattr(settings, "cognee_url", None)
    monkeypatch.setattr(settings, "obsidian_vault_path", str(tmp_path))
    service = MemoryService()
    assert service._primary_store is None
    assert isinstance(service._fallback, ObsidianStore)


def test_enabled_but_unavailable_cognee_degrades(monkeypatch):
    """VERITY_COGNEE=1 but cognee can't init → fall through, don't crash boot."""
    def boom(*a, **k):
        raise CogneeUnavailable("cognee not importable")

    monkeypatch.setattr(cs, "CogneeLibraryStore", boom)
    monkeypatch.setattr(settings, "cognee_enabled", True)
    monkeypatch.setattr(settings, "cognee_url", None)
    monkeypatch.setattr(settings, "obsidian_vault_path", None)
    service = MemoryService()
    assert service._primary_store is None  # degraded to fallback, no exception


def test_import_of_cognee_store_does_not_import_cognee():
    """Loading the module must not drag the heavy optional dep into the process."""
    import sys
    assert "cognee" not in sys.modules
