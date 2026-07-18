"""Tenant context extraction — the only trusted identity source in brain.

The gateway injects x-verity-user-id / x-verity-org-id / x-verity-request-id
into gRPC metadata after session verification. Anything tenant-scoped MUST
call require_tenant(); a request without a user id is aborted UNAUTHENTICATED
(fail closed). Request bodies are never consulted for identity.
"""

from dataclasses import dataclass

import grpc


@dataclass(frozen=True)
class TenantCtx:
    user_id: str
    org_id: str = ""
    request_id: str = ""


async def require_tenant(context: grpc.aio.ServicerContext) -> TenantCtx:
    md = dict(context.invocation_metadata() or ())
    user_id = md.get("x-verity-user-id", "")
    if not user_id:
        await context.abort(grpc.StatusCode.UNAUTHENTICATED, "missing tenant context")
    return TenantCtx(
        user_id=user_id,
        org_id=md.get("x-verity-org-id", ""),
        request_id=md.get("x-verity-request-id", ""),
    )
