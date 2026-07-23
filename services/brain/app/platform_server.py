"""Platform gRPC servicer — the persistence & platform surface of the brain.

Registered on the same brain gRPC server as BrainService and called only by
the gateway. Tenant identity comes from gRPC metadata (require_tenant, fail
closed); every repo call filters by that user id. The one exception is
GetTranscript, which is PUBLIC read-only, keyed solely by an unguessable share
id (the share id is the bearer capability — no tenant metadata is consulted).

Laws honoured here:
  * degrade, never die — persistence RPCs abort UNAVAILABLE (not crash) when
    DATABASE_URL is absent; /healthz reports the missing config.
  * external content is wrapped (wrapUntrusted) before it can enter a prompt:
    upload markdown is wrapped at prompt-assembly time (grpc_server._file_message)
    and MCP tool output is wrapped inside MCPClient.call_tool.
  * MCP calls fail closed on consent; user-supplied MCP base_url is SSRF-guarded.
  * secrets never logged; provider-key material never leaves the vault path.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import tempfile

import grpc

from app.db import db, DBUnavailable
from app.entitlements import service as entitlements
from app.pb.verity.v1 import platform_pb2, platform_pb2_grpc
from app.queue import Job, job_queue
from app.mcp_client import ConsentRequired, MCPClient, MCPError, SSRFError
from app.providers import registry
from app.providers.base import ProviderError
from app.skills.loader import load_skills
from app.tenant import TenantCtx, require_tenant
from app import vault
from app.repos import branches as branches_repo
from app.repos import conversations as conversations_repo
from app.repos import files as files_repo
from app.repos import mcp as mcp_repo
from app.repos import messages as messages_repo
from app.repos import offices as offices_repo
from app.repos import provider_keys as pk_repo

log = logging.getLogger("brain.platform")

# Detached office/flow runs (G12): the servicer creates the durable run row and
# ENQUEUES a Job onto the shared run queue, then returns immediately. A worker
# (in-process pool or a `python -m app.worker` process, Redis-leased) claims the
# job and executes it via app.queue.handlers.dispatch — the same machinery the
# G3 scheduler enqueues onto, so scheduled and manual runs share one path and
# one per-user concurrency cap. The Job carries the office's OWNER user_id, set
# server-side here (never from a request body); the worker re-resolves the
# provider from that owner's vaulted key.

BRANCH_CONTEXT_WINDOW = 12
UPLOAD_MAX_BYTES = 16 * 1024 * 1024  # raw upload cap (markitdown input)


def _iso(dt) -> str:
    return dt.isoformat() if dt is not None else ""


def _pb_message(r) -> platform_pb2.Message:
    return platform_pb2.Message(
        id=r.id,
        role=r.role,
        content=r.content,
        created_at=_iso(r.created_at),
        confidence=r.confidence or 0,
        has_confidence=r.confidence is not None,
    )


async def _require_db(context) -> None:
    if not db.available:
        await context.abort(
            grpc.StatusCode.UNAVAILABLE,
            "this feature requires persistence (DATABASE_URL not configured)",
        )


class PlatformServicer(platform_pb2_grpc.PlatformServiceServicer):
    # --- Conversations -----------------------------------------------------

    async def ListConversations(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        items, next_cursor = await conversations_repo.list_page(
            tenant.user_id, request.cursor or None
        )
        return platform_pb2.ListConversationsResponse(
            items=[
                platform_pb2.Conversation(
                    id=c.id, title=c.title,
                    created_at=_iso(c.created_at), updated_at=_iso(c.updated_at),
                )
                for c in items
            ],
            next_cursor=next_cursor or "",
        )

    async def CreateConversation(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        c = await conversations_repo.create(tenant.user_id, request.title or None)
        return platform_pb2.Conversation(
            id=c.id, title=c.title,
            created_at=_iso(c.created_at), updated_at=_iso(c.updated_at),
        )

    async def GetConversation(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        convo = await conversations_repo.get(tenant.user_id, request.id)
        if convo is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
        msgs = await messages_repo.history(tenant.user_id, convo.id, limit=200)
        return platform_pb2.ConversationDetail(
            id=convo.id, title=convo.title, share_id=convo.share_id,
            messages=[_pb_message(m) for m in msgs],
        )

    async def UpdateConversation(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        c = await conversations_repo.rename(tenant.user_id, request.id, request.title)
        if c is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
        return platform_pb2.Conversation(
            id=c.id, title=c.title,
            created_at=_iso(c.created_at), updated_at=_iso(c.updated_at),
        )

    async def DeleteConversation(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        ok = await conversations_repo.delete(tenant.user_id, request.id)
        if not ok:
            await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
        return platform_pb2.Empty()

    # --- Provider keys -----------------------------------------------------

    async def ListProviderKeys(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        configured = set(await pk_repo.list_providers(tenant.user_id))
        return platform_pb2.ProviderKeysResponse(
            providers=[
                platform_pb2.ProviderKeyStatus(provider=p, configured=(p in configured))
                for p in registry.KEYED_PROVIDERS
            ]
        )

    async def PutProviderKey(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        provider = request.provider.strip().lower()
        if provider not in registry.KEYED_PROVIDERS:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "unknown provider")
        if not request.key.strip():
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "key is required")
        try:
            nonce, ciphertext = vault.encrypt(request.key, user_id=tenant.user_id)
        except vault.VaultUnavailable:
            await context.abort(
                grpc.StatusCode.FAILED_PRECONDITION,
                "key vault not configured (ENCRYPTION_KEY)",
            )
        await pk_repo.put(tenant.user_id, provider, nonce, ciphertext)
        # never log or echo key material
        return platform_pb2.ProviderKeyStatus(provider=provider, configured=True)

    async def DeleteProviderKey(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        await pk_repo.delete(tenant.user_id, request.provider.strip().lower())
        return platform_pb2.Empty()

    async def GetMe(self, request, context):
        tenant = await require_tenant(context)
        caps = await registry.capabilities(tenant.user_id)
        return platform_pb2.MeResponse(
            user_id=tenant.user_id,
            providers=[
                platform_pb2.ProviderInfo(
                    id=c["id"], configured=c["configured"], house=c["house"]
                )
                for c in caps
            ],
        )

    # --- Offices -----------------------------------------------------------

    async def ListOffices(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        rows = await offices_repo.list_all(tenant.user_id)
        return platform_pb2.OfficesResponse(
            items=[self._pb_office(r) for r in rows]
        )

    @staticmethod
    def _pb_office(r) -> platform_pb2.Office:
        d = r.definition or {}
        return platform_pb2.Office(
            id=r.id, name=r.name, schedule=r.schedule_cron,
            brief=d.get("task", ""), status="enabled" if r.enabled else "disabled",
        )

    async def CreateOffice(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        if not request.name.strip() or not request.brief.strip():
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "name and brief are required")
        definition = {
            "task": request.brief,
            "flow_kind": request.flow_kind,
            "model": request.model,
            "workers": request.workers or 2,
        }
        row = await offices_repo.create(
            tenant.user_id, request.name, request.schedule, definition
        )
        return self._pb_office(row)

    async def RunOffice(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        office = await offices_repo.get(tenant.user_id, request.id)
        if office is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "office not found")
        d = office.definition or {}
        # Resolve up-front purely to FAIL FAST on a missing/invalid provider key
        # (the detached worker re-resolves from the stored owner at run time).
        try:
            await registry.resolve_for_user(d.get("model", ""), tenant.user_id)
        except ProviderError as exc:
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, str(exc))
        run_id = await offices_repo.start_run(tenant.user_id, office.id)
        # Enqueue detached (G12). Owner user_id is server-side; the worker runs
        # the office via app.queue.handlers.dispatch and writes STATE/results.
        await job_queue.enqueue(
            Job(
                kind="office",
                user_id=tenant.user_id,
                payload={"office_id": office.id, "run_id": run_id},
            )
        )
        return platform_pb2.RunOfficeResponse(run_id=run_id)

    async def GetOfficeRun(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        run = await offices_repo.get_run(tenant.user_id, request.office_id, request.run_id)
        if run is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "run not found")
        return platform_pb2.OfficeRunDetail(
            run_id=run.id, office_id=run.office_id, status=run.status,
            state_md=run.state_md, started_at=_iso(run.started_at),
            finished_at=_iso(run.finished_at),
        )

    # --- Skills ------------------------------------------------------------

    async def ListSkills(self, request, context):
        # Listing is safe without a DB; skills live on disk. Tenant still
        # required (this is a /v1 route).
        await require_tenant(context)
        root = os.environ.get("VERITY_SKILLS_PATH", "")
        skills = load_skills(root) if root else []
        return platform_pb2.SkillsResponse(
            skills=[
                platform_pb2.SkillInfo(name=s.name, description=s.description)
                for s in skills
            ],
            # Execution stays gated until the executor is OS-isolated (audit H2).
            execution_available=False,
        )

    # --- MCP ---------------------------------------------------------------

    async def ListMcpServers(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        rows = await mcp_repo.list_all(tenant.user_id)
        return platform_pb2.McpServersResponse(
            items=[
                platform_pb2.McpServer(id=r.id, name=r.name, base_url=r.base_url)
                for r in rows
            ]
        )

    async def CreateMcpServer(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        if not request.name.strip() or not request.base_url.strip():
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "name and base_url are required")
        row = await mcp_repo.create(tenant.user_id, request.name, request.base_url)
        return platform_pb2.McpServer(id=row.id, name=row.name, base_url=row.base_url)

    async def McpCall(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        server = await mcp_repo.get(tenant.user_id, request.server_id)
        if server is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "mcp server not found")
        # Consent is fail-closed: proceed only if a grant already exists, or the
        # caller supplies explicit consent this call (which we then persist).
        granted = await mcp_repo.has_consent(tenant.user_id, server.id, request.tool)
        if not granted:
            if not request.consent:
                await context.abort(
                    grpc.StatusCode.PERMISSION_DENIED,
                    f"consent required for tool {request.tool!r}",
                )
            await mcp_repo.grant_consent(tenant.user_id, server.id, request.tool)
        try:
            args = json.loads(request.args_json or "{}")
            if not isinstance(args, dict):
                raise ValueError("args must be a JSON object")
        except ValueError as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"invalid args_json: {exc}")
        client = MCPClient(server.base_url)
        try:
            output = await client.call_tool(request.tool, args, consent=True)
        except SSRFError as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except ConsentRequired as exc:
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, str(exc))
        except MCPError as exc:
            await context.abort(grpc.StatusCode.UNAVAILABLE, str(exc))
        return platform_pb2.McpCallResponse(output=output)

    # --- Upload ------------------------------------------------------------

    async def UploadFile(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        if not request.content:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "empty upload")
        if len(request.content) > UPLOAD_MAX_BYTES:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "upload too large")
        try:
            markdown = await asyncio.to_thread(
                _convert_markdown, request.content, request.name
            )
        except Exception as exc:
            log.warning("markitdown conversion failed for %s: %s", request.name, exc)
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT, "could not convert file to markdown"
            )
        row = await files_repo.create(
            tenant.user_id, request.name or "upload", request.content_type, markdown
        )
        return platform_pb2.UploadFileResponse(
            file_id=row.id, name=row.name, markdown_bytes=row.byte_size
        )

    # --- Branching ---------------------------------------------------------

    async def CreateBranch(self, request, context):
        tenant = await require_tenant(context)
        await _require_db(context)
        kind = request.kind.strip().lower()
        if kind not in ("flow", "office"):
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "kind must be flow|office")
        msg = await messages_repo.get(tenant.user_id, request.message_id)
        if msg is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "message not found")

        # Carry conversation context as the run brief (plan §3). The context is
        # the user's own conversation — internal, not external content.
        history = await messages_repo.history(
            tenant.user_id, msg.conversation_id, limit=BRANCH_CONTEXT_WINDOW
        )
        context_text = "\n".join(f"{m.role}: {m.content}" for m in history)
        brief = request.brief.strip()
        task = (brief + "\n\n" if brief else "") + (
            "Conversation context:\n" + context_text if context_text else ""
        )
        task = task.strip() or brief or "Continue from the conversation."

        # Resolve up-front only to fail fast on a missing provider key; the
        # detached worker re-resolves the default selector from the owner.
        try:
            await registry.resolve_for_user("", tenant.user_id)
        except ProviderError as exc:
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, str(exc))

        if kind == "flow":
            run_id = await branches_repo.create_flow_run(
                tenant.user_id, {"task": task, "kind": "flow"}
            )
            await branches_repo.create(tenant.user_id, msg.id, "flow", run_id)
            # Detached (G12): worker runs the flow via dispatch. "" selector →
            # the worker re-resolves the owner's default model server-side.
            await job_queue.enqueue(
                Job(
                    kind="flow",
                    user_id=tenant.user_id,
                    payload={"run_id": run_id, "task": task, "model": ""},
                )
            )
        else:  # office
            office = await offices_repo.create(
                tenant.user_id,
                f"Branch: {(brief or msg.content)[:60]}",
                "",  # no schedule — a branch is a one-off run
                {"task": task, "flow_kind": "", "model": "", "workers": 2},
            )
            run_id = await offices_repo.start_run(tenant.user_id, office.id)
            await branches_repo.create(tenant.user_id, msg.id, "office", run_id)
            await job_queue.enqueue(
                Job(
                    kind="office",
                    user_id=tenant.user_id,
                    payload={"office_id": office.id, "run_id": run_id},
                )
            )

        return platform_pb2.CreateBranchResponse(run_id=run_id, kind=kind)

    # --- Entitlements + usage metering (anti-tamper) ----------------------

    async def CheckEntitlement(self, request, context):
        """Server-authoritative quota gate. The gateway calls this BEFORE a
        metered action reaches the AI. Identity is the metadata user_id (fail
        closed if absent) — the metric/amount/key in the request are the ONLY
        client-influenced inputs, and none of them is identity or plan: the plan
        and current usage are read from the DB by this user_id. Atomically
        reserves against the ledger (idempotent on the key)."""
        tenant = await require_tenant(context)
        decision = await entitlements.check_and_reserve(
            tenant.user_id,
            request.metric,
            request.amount or 1,
            request.idempotency_key,
        )
        return platform_pb2.CheckEntitlementResponse(
            allowed=decision.allowed,
            enforced=decision.enforced,
            reason=decision.reason,
            limit=decision.limit,
            remaining=decision.remaining,
            plan_id=decision.plan_id,
            retry_after_seconds=decision.retry_after_seconds,
        )

    async def GetEntitlements(self, request, context):
        """Read-only plan + current-window usage for the signed-in user, for the
        frontend to DISPLAY. Never an enforcement input. Keyed to the metadata
        user_id, so a client cannot read another user's usage."""
        tenant = await require_tenant(context)
        snap = await entitlements.snapshot(tenant.user_id)
        return platform_pb2.EntitlementsResponse(
            plan_id=snap.plan_id,
            plan_name=snap.plan_name,
            status=snap.status,
            enforced=snap.enforced,
            metrics=[
                platform_pb2.MetricUsage(
                    metric=m.metric, limit=m.limit, used=m.used,
                    remaining=m.remaining, window="day",
                )
                for m in snap.metrics
            ],
        )

    # --- Transcripts (PUBLIC) ---------------------------------------------

    async def GetTranscript(self, request, context):
        """PUBLIC, read-only. No tenant metadata; keyed by the unguessable share
        id (the bearer capability). Never exposes any mutation or tenant data
        beyond the shared conversation's own messages."""
        if not db.available:
            await context.abort(
                grpc.StatusCode.UNAVAILABLE, "transcripts require persistence"
            )
        share_id = request.share_id.strip()
        if not share_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "share_id required")
        convo = await conversations_repo.get_by_share_id(share_id)
        if convo is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "transcript not found")
        # The share id already authorised the read; messages are addressed by
        # conversation id only (public path, no tenant filter).
        msgs = await messages_repo.for_conversation_public(convo.id)
        return platform_pb2.TranscriptResponse(
            title=convo.title,
            created_at=_iso(convo.created_at),
            messages=[_pb_message(m) for m in msgs],
        )


def _convert_markdown(content: bytes, name: str) -> str:
    """markitdown conversion (audit P6). Runs in a worker thread. The output is
    stored raw and wrapped (wrapUntrusted) at prompt-assembly time before it can
    influence any model (grpc_server._file_message)."""
    from markitdown import MarkItDown

    md = MarkItDown()
    suffix = os.path.splitext(name or "")[1] or ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(content)
        tmp.flush()
        result = md.convert(tmp.name)
    text = getattr(result, "text_content", None)
    if text is None:
        text = getattr(result, "markdown", "") or ""
    return text
