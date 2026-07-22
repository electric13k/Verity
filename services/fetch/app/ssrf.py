"""SSRF guard for the fetch service.

This service renders *arbitrary, model-chosen* URLs in a real browser, so it —
not the brain — is the SSRF boundary (see services/brain/app/tools/web.py). The
brain hands us a url as a body field and never dereferences it itself; the whole
security burden lands here. We mirror the rigor of
``services/brain/app/mcp_client.py`` and extend it, because a headless browser is
a far more capable confused deputy than a JSON-RPC client:

  * scheme allowlist — only ``http`` / ``https`` (no ``file:``, ``data:`` from the
    network path, ``ftp:``, ``gopher:``, ``chrome:``, ...);
  * host resolution — resolve EVERY A/AAAA record and reject if ANY lands in a
    loopback / private / link-local / ULA / CGNAT / metadata / reserved range,
    BEFORE we navigate. A hostname that resolves to 169.254.169.254 (cloud
    metadata) or 127.0.0.1 / 10.x / 192.168.x / fc00:: never gets dialed;
  * port allowlist — only real web ports (80/443 by default, env-widenable), so a
    public host can't be used to reach, say, a database or SSH on an odd port;
  * IPv4-mapped IPv6 (``::ffff:169.254.169.254``) and NAT64 are unwrapped and
    re-checked so they can't smuggle a blocked v4 address through a v6 literal.

The same check runs again on every in-page request (redirects AND subresources)
from the route handler in ``browser.py`` — a 3xx to the metadata IP, or a hostile
page embedding ``<img src=http://169.254.169.254/...>``, is aborted mid-flight.

Honest residual limit (identical to mcp_client's): validating the resolved
address does not fully close a DNS-rebinding TOCTOU race — the browser re-resolves
at connect time. The per-request re-validation plus the port allowlist plus the
egress-only network posture cover the practical vectors (metadata theft, private
subnet scan) an attacker-supplied URL presents. Pinning the validated IP into the
connection is a later hardening.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

ALLOWED_SCHEMES = ("http", "https")
_DEFAULT_PORT = {"http": 80, "https": 443}

# Explicit deny networks, on top of the ipaddress ``is_*`` properties. Needed
# because those properties do NOT cover every plan-required range on every stdlib
# version — notably 100.64.0.0/10 (CGNAT) is ``is_private == False`` on the dev
# container's CPython 3.11. Enumerating the ranges makes the policy version-proof
# and self-documenting rather than trusting a moving stdlib definition.
_BLOCKED_V4 = [
    ipaddress.ip_network(n)
    for n in (
        "0.0.0.0/8",          # "this host" / unspecified
        "10.0.0.0/8",         # RFC1918 private
        "100.64.0.0/10",      # RFC6598 CGNAT  (is_private misses this on 3.11)
        "127.0.0.0/8",        # loopback
        "169.254.0.0/16",     # link-local INCL. 169.254.169.254 cloud metadata
        "172.16.0.0/12",      # RFC1918 private
        "192.0.0.0/24",       # IETF protocol assignments
        "192.0.2.0/24",       # TEST-NET-1
        "192.168.0.0/16",     # RFC1918 private
        "198.18.0.0/15",      # benchmarking
        "198.51.100.0/24",    # TEST-NET-2
        "203.0.113.0/24",     # TEST-NET-3
        "240.0.0.0/4",        # reserved (incl. 255.255.255.255 broadcast)
    )
]
_BLOCKED_V6 = [
    ipaddress.ip_network(n)
    for n in (
        "::1/128",            # loopback
        "::/128",             # unspecified
        "fc00::/7",           # unique-local (ULA)
        "fe80::/10",          # link-local
        "ff00::/8",           # multicast
        "2001:db8::/32",      # documentation
        "64:ff9b::/96",       # NAT64 (can map to a private v4)
    )
]


class SSRFError(ValueError):
    """A target URL failed the SSRF allowlist. Fail closed."""


@dataclass(frozen=True)
class CheckedTarget:
    scheme: str
    host: str
    port: int
    addresses: tuple[str, ...]


def default_allowed_ports() -> frozenset[int]:
    return frozenset({80, 443})


def parse_allowed_ports(raw: str | None) -> frozenset[int]:
    """Parse a comma list like ``"80,443,8443"`` → {80, 443, 8443}. Empty/garbage
    falls back to the safe {80, 443} default (boot-degrades, never dies)."""
    if not raw:
        return default_allowed_ports()
    ports: set[int] = set()
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            p = int(chunk)
        except ValueError:
            continue
        if 0 < p < 65536:
            ports.add(p)
    return frozenset(ports) or default_allowed_ports()


def resolve_host(host: str) -> list[str]:
    """Every A/AAAA address for ``host`` (numeric literals pass straight through).
    Module-level so tests can monkeypatch it to a fixed table without touching the
    network."""
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SSRFError(f"cannot resolve host {host!r}: {exc}") from exc
    return sorted({info[4][0] for info in infos})


async def resolve_host_async(host: str) -> list[str]:
    """Async resolution via the event loop's threadpool getaddrinfo — used on the
    hot per-request path so a slow DNS lookup never blocks the loop."""
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SSRFError(f"cannot resolve host {host!r}: {exc}") from exc
    return sorted({info[4][0] for info in infos})


def ip_is_blocked(ip: IPAddress) -> bool:
    """True if ``ip`` is in any non-routable / internal / metadata range."""
    # Unwrap IPv4-mapped IPv6 (::ffff:a.b.c.d) so a v6 literal can't smuggle a
    # blocked v4 target past the check.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip_is_blocked(ip.ipv4_mapped)
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return True
    nets = _BLOCKED_V4 if ip.version == 4 else _BLOCKED_V6
    return any(ip in net for net in nets)


def _parse_target(url: str, allowed_ports: frozenset[int]) -> tuple[str, str, int]:
    """Validate the *static* parts of ``url`` (scheme, host presence, port) without
    touching DNS. Returns (scheme, host, effective_port) or raises SSRFError."""
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise SSRFError(f"scheme {scheme!r} not allowed (http/https only): {url!r}")
    host = parts.hostname
    if not host:
        raise SSRFError(f"missing host in url: {url!r}")
    try:
        explicit_port = parts.port
    except ValueError as exc:  # non-numeric / out-of-range port component
        raise SSRFError(f"invalid port in url: {url!r}") from exc
    port = explicit_port if explicit_port is not None else _DEFAULT_PORT[scheme]
    if port not in allowed_ports:
        raise SSRFError(
            f"port {port} not allowed (web ports only: "
            f"{sorted(allowed_ports)}): {url!r}"
        )
    return scheme, host, port


def _check_addresses(host: str, addresses: list[str]) -> tuple[str, ...]:
    if not addresses:
        raise SSRFError(f"host {host!r} resolved to no addresses")
    for addr in addresses:
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError as exc:
            raise SSRFError(f"unparseable address {addr!r} for host {host!r}") from exc
        if ip_is_blocked(ip):
            raise SSRFError(
                f"host {host!r} resolves to blocked address {ip} "
                f"(loopback/private/link-local/CGNAT/metadata/reserved range)"
            )
    return tuple(addresses)


def validate_url(
    url: str,
    allowed_ports: frozenset[int] | None = None,
    *,
    resolver=resolve_host,
) -> CheckedTarget:
    """Full synchronous SSRF check: scheme + host + port + resolved-address ranges.
    Raises :class:`SSRFError` on any violation. Used for the pre-navigation gate
    (reject BEFORE we launch a page) and in the unit tests."""
    ports = allowed_ports or default_allowed_ports()
    scheme, host, port = _parse_target(url, ports)
    addresses = _check_addresses(host, resolver(host))
    return CheckedTarget(scheme=scheme, host=host, port=port, addresses=addresses)


async def validate_url_async(
    url: str,
    allowed_ports: frozenset[int] | None = None,
) -> CheckedTarget:
    """Async twin of :func:`validate_url` for the per-request route handler
    (redirect + subresource re-checks) — resolves without blocking the loop."""
    ports = allowed_ports or default_allowed_ports()
    scheme, host, port = _parse_target(url, ports)
    addresses = _check_addresses(host, await resolve_host_async(host))
    return CheckedTarget(scheme=scheme, host=host, port=port, addresses=addresses)
