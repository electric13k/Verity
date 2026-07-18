from app.memory.obsidian import ObsidianStore, _parse
from app.memory.service import MemoryItem, MemoryService
from app.config import settings


async def test_note_roundtrip(tmp_path):
    store = ObsidianStore(tmp_path)
    await store.add(
        "user_a",
        MemoryItem(content="The user prefers metric units", tags=["units", "preference"], importance=0.8),
    )
    notes = list(tmp_path.glob("user_user-a/main/*.md"))
    assert len(notes) == 1
    meta, body = _parse(notes[0].read_text())
    assert meta["importance"] == "0.80"
    assert "metric units" in body

    hits = await store.search("user_a", "main", "metric units?", 5)
    assert len(hits) == 1
    assert hits[0].importance == 0.8


async def test_user_isolation_is_directory_level(tmp_path):
    store = ObsidianStore(tmp_path)
    await store.add("user_a", MemoryItem(content="user a secret fact"))
    assert await store.search("user_b", "main", "secret fact", 5) == []


async def test_path_traversal_is_neutralized(tmp_path):
    store = ObsidianStore(tmp_path)
    await store.add("../../etc", MemoryItem(content="hostile", scope="../up"))
    # Everything must stay inside the vault root.
    written = [p for p in tmp_path.rglob("*.md")]
    assert written, "note should be written"
    for p in written:
        assert tmp_path in p.parents or p == tmp_path


async def test_service_uses_obsidian_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "obsidian_vault_path", str(tmp_path))
    service = MemoryService()
    stored = await service.learn_from_exchange(
        "user_a", "Remember that my name is Anwaar", "Noted, Anwaar."
    )
    assert stored
    assert list(tmp_path.rglob("*.md")), "memory should persist as a markdown note"
    recalled = await service.recall("user_a", "what is my name? anwaar?")
    assert any("Anwaar" in m for m in recalled)
