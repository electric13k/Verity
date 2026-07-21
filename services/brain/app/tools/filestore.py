"""Tenant-scoped store for produced deliverables (G9).

Uploads (inbound) live in Postgres as markdown (app/repos/files.py). Produced
deliverables (outbound: docx/pptx/xlsx/pdf/images) are binary, so they are
written to a per-user directory on disk and referenced by an opaque id — the
same "store it, return a reference" shape as uploads, without needing a new DB
table (and therefore no migration in this territory).

Tenant isolation: the path is keyed by ``user_id`` (from gRPC metadata only),
sanitized to a safe token, so one tenant's deliverables can never be written
into — or, with a correct id, read from — another tenant's directory. A file id
is validated to reject path traversal, so a hostile id fails closed.

Degrade, never die: the root defaults to a temp dir; no env is required.
"""

from __future__ import annotations

import os
import re
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.config import settings

_SAFE = re.compile(r"[^a-zA-Z0-9_-]")
_ID_RE = re.compile(r"^[a-zA-Z0-9]{8,64}$")


def _root() -> Path:
    base = settings.output_files_dir or os.path.join(
        tempfile.gettempdir(), "verity-outputs"
    )
    return Path(base)


def _safe(text: str) -> str:
    return _SAFE.sub("_", (text or "").lower())[:64] or "anon"


def _user_dir(user_id: str) -> Path:
    return _root() / f"user_{_safe(user_id)}"


@dataclass(frozen=True)
class Deliverable:
    file_id: str
    name: str
    content_type: str
    byte_size: int
    path: str


_EXT_TYPE = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
    "png": "image/png",
}


def store(user_id: str, name: str, ext: str, data: bytes) -> Deliverable:
    """Write ``data`` into the caller's tenant directory; return its reference."""
    file_id = uuid.uuid4().hex
    ext = ext.lstrip(".").lower()
    d = _user_dir(user_id)
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{file_id}.{ext}"
    path.write_bytes(data)
    safe_name = _SAFE.sub("_", name or "deliverable") or "deliverable"
    if not safe_name.lower().endswith(f".{ext}"):
        safe_name = f"{safe_name}.{ext}"
    return Deliverable(
        file_id=file_id,
        name=safe_name,
        content_type=_EXT_TYPE.get(ext, "application/octet-stream"),
        byte_size=len(data),
        path=str(path),
    )


def resolve(user_id: str, file_id: str, ext: str) -> Path | None:
    """Path for a stored deliverable owned by ``user_id`` — or None. Fails
    closed on a malformed id (path traversal never escapes the tenant dir)."""
    if not _ID_RE.match(file_id or ""):
        return None
    path = _user_dir(user_id) / f"{file_id}.{ext.lstrip('.').lower()}"
    return path if path.is_file() else None
