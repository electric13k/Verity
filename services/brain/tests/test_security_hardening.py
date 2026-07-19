"""Tests for the H2 skill-executor isolation and H3 MCP SSRF guard."""

import httpx
import pytest

from app import mcp_client
from app.mcp_client import MCPClient, MCPError, SSRFError
from app.skills import executor as ex
from app.skills.loader import load_skill

SKILL_MD = "---\nname: t\ndescription: d\n---\nbody\n"


def make_skill(tmp_path):
    d = tmp_path / "t"
    (d / "scripts").mkdir(parents=True)
    (d / "SKILL.md").write_text(SKILL_MD)
    return load_skill(d)


# --- H2: skill executor isolation ---------------------------------------

async def test_executor_refuses_without_isolation(tmp_path, monkeypatch):
    skill = make_skill(tmp_path)
    (skill.path / "scripts" / "hi.sh").write_text('echo hi\n')
    monkeypatch.setattr(ex, "network_isolation_available", lambda: False)
    monkeypatch.delenv(ex._UNSAFE_ALLOW_ENV, raising=False)

    # Fail closed: no network isolation, no override -> refuse.
    with pytest.raises(ex.SkillExecutionError, match="network isolation"):
        await ex.run_script(skill, "scripts/hi.sh")

    # Explicit dev override runs it.
    res = await ex.run_script(skill, "scripts/hi.sh", allow_unsafe=True)
    assert res.exit_code == 0
    assert "hi" in res.output

    # Env override also runs it.
    monkeypatch.setenv(ex._UNSAFE_ALLOW_ENV, "1")
    res2 = await ex.run_script(skill, "scripts/hi.sh")
    assert "hi" in res2.output


async def test_executor_output_cap_enforced(tmp_path):
    skill = make_skill(tmp_path)
    # Emit far more than MAX_OUTPUT_BYTES; must be killed, not buffered whole.
    (skill.path / "scripts" / "flood.sh").write_text(
        "head -c 300000 /dev/zero | tr '\\0' 'A'\n"
    )
    with pytest.raises(ex.SkillExecutionError, match="output cap"):
        await ex.run_script(skill, "scripts/flood.sh", timeout=20)


async def test_executor_refuses_nested_data_root(tmp_path, monkeypatch):
    skill = make_skill(tmp_path)
    (skill.path / "scripts" / "hi.sh").write_text('echo hi\n')
    vault = skill.path / "vault"
    vault.mkdir()
    monkeypatch.setenv("OBSIDIAN_VAULT_PATH", str(vault))
    with pytest.raises(ex.SkillExecutionError, match="data root"):
        await ex.run_script(skill, "scripts/hi.sh")


@pytest.mark.skipif(
    not ex.network_isolation_available(),
    reason="network namespaces unavailable in this environment",
)
async def test_executor_network_is_isolated(tmp_path):
    skill = make_skill(tmp_path)
    (skill.path / "scripts" / "net.sh").write_text(
        "getent hosts example.com >/dev/null 2>&1 && echo NET_OK || echo NET_BLOCKED\n"
    )
    res = await ex.run_script(skill, "scripts/net.sh")
    assert "NET_BLOCKED" in res.output
    assert "NET_OK" not in res.output


async def test_executor_workdir_is_not_skill_dir(tmp_path):
    skill = make_skill(tmp_path)
    (skill.path / "scripts" / "pwd.sh").write_text("pwd\n")
    res = await ex.run_script(skill, "scripts/pwd.sh")
    # cwd is a dedicated throwaway dir, never the skill directory.
    assert str(skill.path) not in res.output
    assert "verity-skill-" in res.output


# --- H3: MCP SSRF guard --------------------------------------------------

@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata
        "https://169.254.169.254/",                   # metadata over https too
        "https://10.0.0.5/rpc",                       # RFC1918
        "https://192.168.1.1/rpc",                    # RFC1918
        "https://172.16.0.1/rpc",                     # RFC1918
        "https://127.0.0.1/rpc",                      # loopback (not dev)
        "https://[::1]/rpc",                          # IPv6 loopback
        "https://[fe80::1]/rpc",                      # IPv6 link-local
        "https://[fc00::1]/rpc",                      # IPv6 unique-local
    ],
)
def test_ssrf_rejects_internal_targets(url):
    with pytest.raises(SSRFError):
        mcp_client._validate_url(url)


def test_ssrf_rejects_non_http_scheme():
    with pytest.raises(SSRFError, match="scheme"):
        mcp_client._validate_url("file:///etc/passwd")
    with pytest.raises(SSRFError, match="scheme"):
        mcp_client._validate_url("gopher://example.com/")


def test_ssrf_https_only_for_public(monkeypatch):
    monkeypatch.setattr(mcp_client, "resolve_host", lambda h: ["93.184.216.34"])
    monkeypatch.delenv(mcp_client._DEV_MODE_ENV, raising=False)
    # http to a public host is refused...
    with pytest.raises(SSRFError, match="http scheme"):
        mcp_client._validate_url("http://example.com/rpc")
    # ...https to the same public host is allowed.
    mcp_client._validate_url("https://example.com/rpc")


def test_ssrf_http_loopback_allowed_only_in_dev(monkeypatch):
    monkeypatch.setattr(mcp_client, "resolve_host", lambda h: ["127.0.0.1"])
    monkeypatch.delenv(mcp_client._DEV_MODE_ENV, raising=False)
    with pytest.raises(SSRFError):
        mcp_client._validate_url("http://localhost:9000/rpc")
    monkeypatch.setenv(mcp_client._DEV_MODE_ENV, "1")
    mcp_client._validate_url("http://localhost:9000/rpc")  # no raise in dev


def _fake_server(request: httpx.Request) -> httpx.Response:
    import json as _json

    body = _json.loads(request.content)
    rid = body["id"]
    if body["method"] == "initialize":
        result = {"serverInfo": {"name": "fake"}, "capabilities": {}}
    elif body["method"] == "tools/list":
        result = {"tools": [{"name": "add", "description": "", "inputSchema": {}}]}
    else:
        result = {}
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": rid, "result": result})


async def test_ssrf_http_loopback_dev_call_succeeds(monkeypatch):
    monkeypatch.setenv(mcp_client._DEV_MODE_ENV, "1")
    monkeypatch.setattr(mcp_client, "resolve_host", lambda h: ["127.0.0.1"])
    client = MCPClient(
        "http://127.0.0.1:9000/rpc",
        client=httpx.AsyncClient(transport=httpx.MockTransport(_fake_server)),
    )
    tools = await client.list_tools()
    assert tools[0].name == "add"


async def test_ssrf_redirect_is_rejected(monkeypatch):
    monkeypatch.setattr(mcp_client, "resolve_host", lambda h: ["93.184.216.34"])

    def redirector(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://169.254.169.254/"})

    client = MCPClient(
        "https://mcp.test/rpc",
        client=httpx.AsyncClient(transport=httpx.MockTransport(redirector)),
    )
    with pytest.raises(SSRFError, match="redirect"):
        await client.initialize()


async def test_ssrf_response_body_cap(monkeypatch):
    monkeypatch.setattr(mcp_client, "resolve_host", lambda h: ["93.184.216.34"])
    monkeypatch.setattr(mcp_client, "MAX_RESPONSE_BYTES", 64)

    def big(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"A" * 4096)

    client = MCPClient(
        "https://mcp.test/rpc",
        client=httpx.AsyncClient(transport=httpx.MockTransport(big)),
    )
    with pytest.raises(MCPError, match="cap"):
        await client.initialize()
