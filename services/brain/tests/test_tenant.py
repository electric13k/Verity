import grpc
import pytest

from app.tenant import require_tenant


class FakeContext:
    """Minimal grpc.aio.ServicerContext stand-in."""

    def __init__(self, metadata):
        self._metadata = metadata
        self.aborted_with = None

    def invocation_metadata(self):
        return tuple(self._metadata.items())

    async def abort(self, code, details):
        self.aborted_with = (code, details)
        raise grpc.RpcError(details)


@pytest.mark.asyncio
async def test_tenant_extracted_from_metadata():
    ctx = FakeContext(
        {
            "x-verity-user-id": "user_a",
            "x-verity-org-id": "org_1",
            "x-verity-request-id": "req-9",
        }
    )
    tenant = await require_tenant(ctx)
    assert tenant.user_id == "user_a"
    assert tenant.org_id == "org_1"
    assert tenant.request_id == "req-9"


@pytest.mark.asyncio
async def test_missing_user_fails_closed():
    ctx = FakeContext({"x-verity-request-id": "req-9"})
    with pytest.raises(grpc.RpcError):
        await require_tenant(ctx)
    assert ctx.aborted_with[0] == grpc.StatusCode.UNAUTHENTICATED


@pytest.mark.asyncio
async def test_body_identity_is_never_trusted():
    """Identity comes from metadata only — an empty metadata set aborts even
    if a request body claims a user (bodies are not even inspected)."""
    ctx = FakeContext({})
    with pytest.raises(grpc.RpcError):
        await require_tenant(ctx)
