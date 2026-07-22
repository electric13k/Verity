"""SSRF guard — the security-critical surface. Hermetic: DNS is injected via the
``resolver`` parameter so no test touches the network."""

from __future__ import annotations

import ipaddress

import pytest

from app.ssrf import (
    SSRFError,
    default_allowed_ports,
    ip_is_blocked,
    parse_allowed_ports,
    validate_url,
)


def _resolver(*addrs):
    return lambda host: list(addrs)


# --- blocked destination addresses (resolve to an internal/metadata range) ---
BLOCKED = [
    ("cloud metadata (AWS/GCP/Azure)", "http://metadata.example/latest/", "169.254.169.254"),
    ("metadata literal", "http://169.254.169.254/latest/meta-data/", "169.254.169.254"),
    ("loopback literal", "http://127.0.0.1/", "127.0.0.1"),
    ("loopback name", "http://localhost/", "127.0.0.1"),
    ("rfc1918 10/8", "http://internal/", "10.0.0.5"),
    ("rfc1918 172.16/12", "http://internal/", "172.16.9.9"),
    ("rfc1918 192.168/16", "http://router/", "192.168.1.1"),
    ("cgnat 100.64/10", "http://cgnat/", "100.64.0.1"),
    ("link-local 169.254/16", "http://ll/", "169.254.1.1"),
    ("ipv6 loopback", "http://v6lo/", "::1"),
    ("ipv6 ULA fc00::/7", "http://ula/", "fc00::1"),
    ("ipv6 link-local fe80::/10", "http://v6ll/", "fe80::1"),
    ("ipv4-mapped-ipv6 metadata", "http://mapped/", "::ffff:169.254.169.254"),
    ("unspecified", "http://any/", "0.0.0.0"),
]


@pytest.mark.parametrize("label,url,addr", BLOCKED, ids=[b[0] for b in BLOCKED])
def test_blocked_hosts_rejected(label, url, addr):
    with pytest.raises(SSRFError):
        validate_url(url, resolver=_resolver(addr))


def test_any_blocked_address_rejects_even_if_one_is_public():
    # A hostname resolving to BOTH a public and an internal address is rejected
    # (fail closed) — this is the classic DNS split trick.
    with pytest.raises(SSRFError):
        validate_url("http://mixed/", resolver=_resolver("93.184.216.34", "169.254.169.254"))


# --- schemes -----------------------------------------------------------------
@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "ftp://example.com/x",
    "gopher://example.com/",
    "data:text/html,hi",
    "chrome://settings",
])
def test_non_http_schemes_rejected(url):
    with pytest.raises(SSRFError):
        validate_url(url, resolver=_resolver("93.184.216.34"))


# --- ports -------------------------------------------------------------------
def test_default_ports_allow_web_only():
    assert validate_url("http://ok/", resolver=_resolver("93.184.216.34")).port == 80
    assert validate_url("https://ok/", resolver=_resolver("93.184.216.34")).port == 443


@pytest.mark.parametrize("url", [
    "http://ok:22/",     # ssh
    "http://ok:6379/",   # redis
    "http://ok:3306/",   # mysql
    "https://ok:8443/",  # not in the default web allowlist
])
def test_non_web_ports_rejected(url):
    with pytest.raises(SSRFError):
        validate_url(url, resolver=_resolver("93.184.216.34"))


def test_widened_port_allowlist_permits_extra_port():
    ports = parse_allowed_ports("80,443,8443")
    t = validate_url("https://ok:8443/", ports, resolver=_resolver("93.184.216.34"))
    assert t.port == 8443


# --- allowed (public) --------------------------------------------------------
@pytest.mark.parametrize("addr", ["93.184.216.34", "1.1.1.1", "2606:2800:220:1:248:1893:25c8:1946"])
def test_public_addresses_allowed(addr):
    t = validate_url("https://example.com/path?q=1", resolver=_resolver(addr))
    assert t.host == "example.com"
    assert addr in t.addresses


def test_missing_host_rejected():
    with pytest.raises(SSRFError):
        validate_url("https:///nohost", resolver=_resolver("93.184.216.34"))


def test_resolution_failure_fails_closed():
    def boom(host):
        raise SSRFError("cannot resolve")
    with pytest.raises(SSRFError):
        validate_url("https://nx.example/", resolver=boom)


# --- ip classification unit checks ------------------------------------------
@pytest.mark.parametrize("addr,blocked", [
    ("169.254.169.254", True),
    ("127.0.0.1", True),
    ("10.1.2.3", True),
    ("172.16.0.1", True),
    ("192.168.0.1", True),
    ("100.64.0.1", True),      # CGNAT — NOT is_private on stdlib 3.11, caught explicitly
    ("100.127.255.255", True),
    ("::1", True),
    ("fc00::1", True),
    ("fe80::1", True),
    ("::ffff:127.0.0.1", True),
    ("93.184.216.34", False),
    ("1.1.1.1", False),
    ("8.8.8.8", False),
])
def test_ip_is_blocked(addr, blocked):
    assert ip_is_blocked(ipaddress.ip_address(addr)) is blocked


def test_default_allowed_ports():
    assert default_allowed_ports() == frozenset({80, 443})
    assert parse_allowed_ports("") == frozenset({80, 443})       # empty → safe default
    assert parse_allowed_ports("garbage,,x") == frozenset({80, 443})
