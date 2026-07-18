"""Brain gRPC server — the gateway's door into orchestration.

Tenant identity and request id arrive in gRPC metadata injected by the
gateway (x-verity-user-id, x-verity-org-id, x-verity-request-id); nothing
in a request body is trusted for identity.
"""

import logging

import grpc

import app.pb  # noqa: F401  (puts generated stubs on sys.path)
from verity.v1 import brain_pb2, brain_pb2_grpc, common_pb2, core_pb2, core_pb2_grpc

from app.config import settings

log = logging.getLogger("brain.grpc")

VERSION = "0.1.0"

METADATA_KEYS = ("x-verity-user-id", "x-verity-org-id", "x-verity-request-id")


def forwarded_metadata(context: grpc.aio.ServicerContext) -> list[tuple[str, str]]:
    """Propagate verity metadata (tenant ctx + request id) to downstream calls."""
    incoming = dict(context.invocation_metadata() or ())
    return [(k, incoming[k]) for k in METADATA_KEYS if k in incoming]


class BrainServicer(brain_pb2_grpc.BrainServiceServicer):
    async def Health(self, request, context):
        missing = settings.missing()
        return common_pb2.HealthResponse(
            status=(
                common_pb2.HealthResponse.STATUS_DEGRADED
                if missing
                else common_pb2.HealthResponse.STATUS_OK
            ),
            service="brain",
            version=VERSION,
            missing_config=missing,
        )

    async def Hello(self, request, context):
        """M1 hello-path: gateway → brain (→ core when reachable)."""
        core_echo = ""
        core_addr = settings.core_grpc_addr or "127.0.0.1:9200"
        try:
            async with grpc.aio.insecure_channel(core_addr) as channel:
                core = core_pb2_grpc.CoreServiceStub(channel)
                resp = await core.Echo(
                    core_pb2.EchoRequest(message=request.message),
                    metadata=forwarded_metadata(context),
                    timeout=3.0,
                )
                core_echo = resp.message
        except grpc.aio.AioRpcError as exc:  # degrade, never die
            log.warning("core unreachable at %s: %s", core_addr, exc.code())
        return brain_pb2.HelloResponse(
            message=f"brain-hello: {request.message}", core_echo=core_echo
        )

    async def ChatStream(self, request, context):
        # Lands in M3.
        await context.abort(grpc.StatusCode.UNIMPLEMENTED, "ChatStream lands in M3")


async def serve(addr: str) -> grpc.aio.Server:
    server = grpc.aio.server()
    brain_pb2_grpc.add_BrainServiceServicer_to_server(BrainServicer(), server)
    server.add_insecure_port(addr)
    await server.start()
    log.info("brain grpc listening on %s", addr)
    return server
