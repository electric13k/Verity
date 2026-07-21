"""G9 file-output tools: each produces a valid file stored tenant-scoped, or
degrades cleanly when its optional lib is absent. Image gen is gated.
"""

import sys
import zipfile

import pytest

from app.config import settings
from app.tenant import TenantCtx
from app.tools import filestore
from app.tools.files import (
    DocxTool,
    ImageGenTool,
    PdfTool,
    PptxTool,
    XlsxTool,
    file_output_tools,
)

TENANT = TenantCtx(user_id="user_a")
OTHER = TenantCtx(user_id="user_b")

MARKDOWN = "# Report\n\nIntro paragraph.\n\n- point one\n- point two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n"


def _file_id(result) -> str:
    for line in result.content.splitlines():
        if line.startswith("file_id:"):
            return line.split(":", 1)[1].strip()
    raise AssertionError(f"no file_id in {result.content!r}")


@pytest.mark.parametrize(
    "tool_cls, ext, magic",
    [
        (DocxTool, "docx", b"PK"),
        (PptxTool, "pptx", b"PK"),
        (XlsxTool, "xlsx", b"PK"),
        (PdfTool, "pdf", b"%PDF"),
    ],
)
async def test_file_tool_produces_and_stores_tenant_scoped(
    monkeypatch, tmp_path, tool_cls, ext, magic
):
    monkeypatch.setattr(settings, "output_files_dir", str(tmp_path))
    result = await tool_cls().run({"markdown": MARKDOWN, "filename": "out"}, TENANT)
    assert not result.is_error
    assert result.content.startswith("<untrusted_external_data>")
    file_id = _file_id(result)

    # Stored, valid, and under THIS tenant's directory only.
    path = filestore.resolve(TENANT.user_id, file_id, ext)
    assert path is not None and path.exists()
    data = path.read_bytes()
    assert data[: len(magic)] == magic and len(data) > 100
    assert f"user_{TENANT.user_id}" in str(path)
    # OOXML files are real zips with the expected part.
    if magic == b"PK":
        with zipfile.ZipFile(path) as zf:
            assert any(n.endswith(".xml") for n in zf.namelist())

    # Fail-closed cross-tenant: another user cannot resolve this file id.
    assert filestore.resolve(OTHER.user_id, file_id, ext) is None


async def test_file_tool_degrades_when_lib_absent(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "output_files_dir", str(tmp_path))
    # Simulate python-docx not installed: importing `docx` raises ImportError.
    monkeypatch.setitem(sys.modules, "docx", None)
    result = await DocxTool().run({"markdown": "# hi"}, TENANT)
    assert not result.is_error
    assert "not installed" in result.content and "python-docx" in result.content


async def test_file_tool_requires_markdown():
    result = await PdfTool().run({"markdown": "   "}, TENANT)
    assert result.is_error and "required" in result.content


async def test_image_gen_gated(monkeypatch):
    monkeypatch.setattr(settings, "image_api_key", None)
    unconfigured = await ImageGenTool().run({"prompt": "a cat"}, TENANT)
    assert not unconfigured.is_error and "not configured" in unconfigured.content

    monkeypatch.setattr(settings, "image_api_key", "present")
    keyed = await ImageGenTool().run({"prompt": "a cat"}, TENANT)
    # Wired for a key, but no adapter → still a clean, non-fabricated result.
    assert not keyed.is_error and "no image was produced" in keyed.content


def test_file_output_tools_set():
    names = {t.name for t in file_output_tools()}
    assert names == {"create_docx", "create_pptx", "create_xlsx", "create_pdf", "generate_image"}
