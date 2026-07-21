"""Knowledge base ("Brain Garden") — persistent per-user/project document
ingestion → grounded RAG, SEPARATE from auto-learned facts.

See app/kb/service.py. Exposed to the model as the ``kb_search`` /
``kb_ingest`` tools (app/tools/kb_tools.py); the list/add/delete surface the UI
needs is on the KBService for a future gateway route.
"""

from app.kb.service import KBService, kb_service

__all__ = ["KBService", "kb_service"]
