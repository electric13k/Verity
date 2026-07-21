"""G7 knowledge base: ingest + grounded search round-trips, and cross-tenant /
cross-project retrieval fails closed (identity from metadata only). Runs on the
in-process fallback store — no cognee needed.
"""

import pytest

from app.kb.service import KBService, chunk_text
from app.tenant import TenantCtx
from app.tools.kb_tools import KbIngestTool, KbSearchTool

USER_A = TenantCtx(user_id="user_a")
USER_B = TenantCtx(user_id="user_b")


def _kb(tmp_path) -> KBService:
    return KBService(index_root=str(tmp_path))


async def test_ingest_search_roundtrip(tmp_path):
    kb = _kb(tmp_path)
    doc = await kb.ingest(
        "user_a", "quokkas", "Quokkas are small marsupials native to Australia.", "wildlife"
    )
    assert doc.chunks >= 1 and doc.project == "wildlife"
    hits = await kb.search("user_a", "what marsupials live in australia", "wildlife")
    assert any("marsupial" in h.lower() for h in hits)


async def test_cross_tenant_search_fails_closed(tmp_path):
    kb = _kb(tmp_path)
    await kb.ingest("user_a", "secret", "Alpha project uses the codename Falcon.", "proj")
    # Same query, different tenant → nothing. Isolation is fail-closed.
    hits_b = await kb.search("user_b", "what is the codename", "proj")
    assert hits_b == []
    hits_a = await kb.search("user_a", "what is the codename Falcon", "proj")
    assert any("falcon" in h.lower() for h in hits_a)


async def test_cross_project_isolation(tmp_path):
    kb = _kb(tmp_path)
    await kb.ingest("user_a", "d", "The mitochondria is the powerhouse of the cell.", "biology")
    # Right user, wrong project → no leakage across projects.
    assert await kb.search("user_a", "powerhouse of the cell", "chemistry") == []
    assert await kb.search("user_a", "powerhouse of the cell", "biology")


async def test_list_and_delete_docs(tmp_path):
    kb = _kb(tmp_path)
    d1 = await kb.ingest("user_a", "one", "content about rust programming", "code")
    await kb.ingest("user_a", "two", "content about python programming", "code")
    docs = kb.list_docs("user_a", "code")
    assert {d.name for d in docs} == {"one", "two"}
    # Another tenant sees none of it.
    assert kb.list_docs("user_b", "code") == []
    removed = kb.delete_doc("user_a", d1.id)
    assert removed is not None and removed.name == "one"
    assert {d.name for d in kb.list_docs("user_a", "code")} == {"two"}


async def test_kb_tools_roundtrip_and_isolation(tmp_path):
    kb = _kb(tmp_path)
    ingest = KbIngestTool(service=kb)
    search = KbSearchTool(service=kb)

    res = await ingest.run(
        {"name": "notes", "content": "Verity uses cognee as the primary memory engine.", "project": "p"},
        USER_A,
    )
    assert not res.is_error and "doc_id:" in res.content

    found = await search.run({"query": "what memory engine does verity use", "project": "p"}, USER_A)
    assert not found.is_error and "cognee" in found.content
    assert found.content.startswith("<untrusted_external_data>")

    # kb_search scoped by tenant metadata only — user_b gets nothing.
    other = await search.run({"query": "what memory engine does verity use", "project": "p"}, USER_B)
    assert "no matching knowledge-base content" in other.content


def test_chunking_bounds():
    chunks = chunk_text("para one\n\n" + ("x" * 5000))
    assert chunks and all(len(c) <= 1200 for c in chunks)
    assert chunk_text("   ") == []
