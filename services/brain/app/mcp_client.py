"""Minimal MCP client (streamable HTTP / JSON-RPC 2.0): initialize,
tools/list, tools/call. Enough for users to connect HTTP MCP servers and
surface their tools in chat/flow; stdio transport ships with the desktop
app (M8).

Consent: every call requires an explicit consent flag from the calling
surface — per-tool consent UI lands at M4/M5 frontend; the brain refuses
without it. Tool results are external content: wrapped before prompts.

SSRF guard (audit H3): the ``base_url`` is user-supplied ("connect an MCP
server"), so before every request we:
  - allow only the ``https`` scheme, except ``http`` to a loopback host when
    ``VERITY_DEV_MODE=1`` (local development);
  - resolve the host's A/AAAA records and reject any that fall in
    private / loopback / link-local / metadata ranges (169.254.0.0/16,
    RFC1918, ::1, fc00::/7, fe80::/10, multicast, reserved) — the sole
    exception being the loopback-in-dev case above;
  - refuse to follow redirects (a 3xx is rejected, closing redirect-based
    SSRF), and
  - cap the response body (audit L3) so a hostile server can't exhaust memory.

Honest residual limit: validating resolved addresses does not fully close a
DNS-rebinding TOCTOU race (httpx re-resolves at connect time). Pinning the
validated IP into the transport is a Stage-C hardening; the redirect ban plus
address validation cover the practical SSRF vectors (metadata, private subnet
scan) an attacker-supplied URL presents today.
"""

import ipaddress
import itertools
import json
import os
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from app.wrap import wrap_untrusted

PROTOCOL_VERSION = "2025-03-26"
MAX_RESPONSE_BYTES = 8 * 1024 * 1024  # cap JSON-RPC response bodies (audit L3)
_DEV_MODE_ENV = "VERITY_DEV_MODE"


class MCPError(RuntimeError):
    pass


class ConsentRequired(MCPError):
    pass


class SSRFError(MCPError):
    """Raised when a request target fails the SSRF allowlist."""


@dataclass(frozen=True)
class MCPTool:
    name: str
    description: str
    input_schema: dict


def _dev_mode() -> bool:
    return os.environ.get(_DEV_MODE_ENV) == "1"


def resolve_host(host: str) -> list[str]:
    """Every A/AAAA address for ``host`` (numeric hosts pass through). Split
    out as a module function so tests can substitute resolution."""
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SSRFError(f"cannot resolve host {host!r}: {exc}") from exc
    return sorted({info[4][0] for info in infos})


def _ip_is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_private          # RFC1918, fc00::/7, 169.254/16, ...
        or ip.is_loopback      # 127/8, ::1
        or ip.is_link_local    # 169.254/16, fe80::/10 (cloud metadata)
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _validate_url(url: str) -> None:
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    host = parts.hostname
    if scheme not in ("http", "https"):
        raise SSRFError(f"scheme {scheme!r} not allowed (https only): {url!r}")
    if not host:
        raise SSRFError(f"missing host in url: {url!r}")

    dev = _dev_mode()
    resolved: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for addr in resolve_host(host):
        try:
            resolved.append(ipaddress.ip_address(addr))
        except ValueError as exc:
            raise SSRFError(f"unparseable address {addr!r} for host {host!r}") from exc
    if not resolved:
        raise SSRFError(f"host {host!r} resolved to no addresses")

    for ip in resolved:
        loopback_dev_ok = dev and ip.is_loopback
        if _ip_is_blocked(ip) and not loopback_dev_ok:
            raise SSRFError(
                f"host {host!r} resolves to blocked address {ip} "
                f"(private/loopback/link-local/metadata range)"
            )

    if scheme == "http" and not (dev and all(ip.is_loopback for ip in resolved)):
        raise SSRFError(
            f"http scheme is permitted only for loopback in dev mode: {url!r}"
        )


class MCPClient:
    def __init__(self, base_url: str, client: httpx.AsyncClient | None = None):
        self._url = base_url
        self._client = client or httpx.AsyncClient(timeout=30)
        self._ids = itertools.count(1)
        self._initialized = False

    async def _rpc(self, method: str, params: dict | None = None) -> dict:
        payload = await self._post_json(
            {
                "jsonrpc": "2.0",
                "id": next(self._ids),
                "method": method,
                "params": params or {},
            }
        )
        if "error" in payload:
            raise MCPError(str(payload["error"].get("message", "mcp error")))
        return payload.get("result", {})

    async def _post_json(self, body: dict) -> dict:
        _validate_url(self._url)
        async with self._client.stream(
            "POST",
            self._url,
            json=body,
            headers={"accept": "application/json"},
            follow_redirects=False,
        ) as resp:
            if resp.is_redirect:
                raise SSRFError(
                    f"redirects are not permitted (got {resp.status_code} to "
                    f"{resp.headers.get('location')!r})"
                )
            if resp.status_code != 200:
                raise MCPError(f"mcp server status {resp.status_code}")
            declared = resp.headers.get("content-length")
            if declared is not None and declared.isdigit() and int(declared) > MAX_RESPONSE_BYTES:
                raise MCPError(
                    f"mcp response exceeds cap ({MAX_RESPONSE_BYTES} bytes)"
                )
            chunks: list[bytes] = []
            total = 0
            async for chunk in resp.aiter_bytes():
                total += len(chunk)
                if total > MAX_RESPONSE_BYTES:
                    raise MCPError(
                        f"mcp response exceeds cap ({MAX_RESPONSE_BYTES} bytes)"
                    )
                chunks.append(chunk)
        return json.loads(b"".join(chunks))

    async def initialize(self) -> dict:
        result = await self._rpc(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "verity-brain", "version": "0.1.0"},
            },
        )
        self._initialized = True
        return result

    async def list_tools(self) -> list[MCPTool]:
        if not self._initialized:
            await self.initialize()
        result = await self._rpc("tools/list")
        return [
            MCPTool(
                name=t.get("name", ""),
                description=t.get("description", ""),
                input_schema=t.get("inputSchema", {}),
            )
            for t in result.get("tools", [])
        ]

    async def call_tool_raw(self, name: str, arguments: dict, *, consent: bool) -> str:
        """The tool's text output, UNWRAPPED. Refuses without explicit consent —
        fail closed. Callers that feed this into a prompt MUST wrap it first
        (wrapUntrusted); the tool registry is the single choke point that does so
        (and BOP-sanitizes) uniformly across every tool. Use ``call_tool`` for a
        directly-prompt-safe (wrapped) result."""
        if not consent:
            raise ConsentRequired(f"user consent required for tool {name!r}")
        if not self._initialized:
            await self.initialize()
        result = await self._rpc("tools/call", {"name": name, "arguments": arguments})
        parts = [
            c.get("text", "")
            for c in result.get("content", [])
            if c.get("type") == "text"
        ]
        return "\n".join(parts)

    async def call_tool(self, name: str, arguments: dict, *, consent: bool) -> str:
        """Returns prompt-safe (wrapped) tool output. Refuses without
        explicit consent — fail closed."""
        raw = await self.call_tool_raw(name, arguments, consent=consent)
        return wrap_untrusted(raw, source=f"mcp:{name}")
