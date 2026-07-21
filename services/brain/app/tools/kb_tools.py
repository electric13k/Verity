"""G7 knowledge-base tools — grounded retrieval (and optional ingest) over the
user's ingested documents, callable by the model.

``kb_search`` is the grounded-RAG retrieval tool: it searches ONLY the caller's
own (user, project) dataset — tenant identity comes from ``tenant.user_id``
(gRPC metadata), never from a tool argument, so a hostile ``project`` value can
never reach another tenant's data. Results are documents the user ingested but
still EXTERNAL content, so they ride the ``prompt_safe`` choke point
(BOP-sanitize + wrapUntrusted) before re-entering the prompt.

Degrade, never die: with nothing ingested (or no store) it returns a clean
"no matching knowledge" result.
"""

from __future__ import annotations

from app.kb.service import kb_service
from app.tenant import TenantCtx
from app.tools.base import Tool, ToolResult, prompt_safe

_MAX_K = 8


class KbSearchTool(Tool):
    name = "kb_search"
    description = (
        "Search the user's knowledge base (ingested documents) for passages "
        "relevant to a query, and return them for grounding. Optionally scope to "
        "a project."
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What to look up."},
            "project": {
                "type": "string",
                "description": "Optional project to scope the search to.",
            },
        },
        "required": ["query"],
    }

    def __init__(self, service=kb_service):
        self._kb = service

    async def run(self, args: dict, tenant: TenantCtx) -> ToolResult:
        query = (args.get("query") or "").strip()
        if not query:
            return ToolResult(
                prompt_safe("a search query is required", source="kb_search"),
                is_error=True,
            )
        project = args.get("project") or None
        # user_id from metadata only — tenant/project isolation is fail-closed.
        hits = await self._kb.search(tenant.user_id, query, project, k=_MAX_K)
        if not hits:
            return ToolResult(
                prompt_safe(
                    "no matching knowledge-base content was found",
                    source="kb_search",
                ),
            )
        body = "\n\n---\n\n".join(hits)
        return ToolResult(prompt_safe(body, source="kb_search"))


class KbIngestTool(Tool):
    name = "kb_ingest"
    description = (
        "Add a document to the user's knowledge base so it can be retrieved "
        "later with kb_search. Provide the text content and a name."
    )
    parameters = {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "A name for the document."},
            "content": {"type": "string", "description": "The document text."},
            "project": {
                "type": "string",
                "description": "Optional project to file the document under.",
            },
        },
        "required": ["name", "content"],
    }

    def __init__(self, service=kb_service):
        self._kb = service

    async def run(self, args: dict, tenant: TenantCtx) -> ToolResult:
        name = (args.get("name") or "").strip()
        content = args.get("content")
        if not name or not isinstance(content, str) or not content.strip():
            return ToolResult(
                prompt_safe("name and content are required", source="kb_ingest"),
                is_error=True,
            )
        project = args.get("project") or None
        doc = await self._kb.ingest(tenant.user_id, name, content, project)
        body = (
            f"Ingested into knowledge base.\ndoc_id: {doc.id}\nname: {doc.name}\n"
            f"project: {doc.project}\nchunks: {doc.chunks}"
        )
        return ToolResult(prompt_safe(body, source="kb_ingest"))


def kb_tools() -> list[Tool]:
    return [KbSearchTool(), KbIngestTool()]
