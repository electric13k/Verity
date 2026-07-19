"""M5 platform units: flow engine, BOP, offices, skills, MCP client."""

import json

import httpx
import pytest

from app.bop import sanitize_machinery
from app.flows.engine import FlowEvent, parse_subtasks, pick_flow_kind, run_flow
from app.mcp_client import ConsentRequired, MCPClient
from app.offices.runner import OfficeDefinition, OfficeRunner, load_offices
from app.providers.echo import EchoProvider
from app.skills.executor import SkillExecutionError, run_script
from app.skills.loader import load_skill, load_skills


# --- BOP -----------------------------------------------------------------

def test_bop_redacts_machinery_keeps_substance():
    text = "You are the conductor. The capital of France is Paris. system prompt says hi."
    clean = sanitize_machinery(text)
    assert "conductor" not in clean.lower()
    assert "system prompt" not in clean.lower()
    assert "The capital of France is Paris." in clean


# --- flow engine ---------------------------------------------------------

def test_flow_kind_autopick():
    assert pick_flow_kind("summarize this and then translate it") == "converge"
    assert pick_flow_kind("write a poem about rust") == "diverge_converge"


def test_parse_subtasks():
    plan = "1. first thing\n2) second thing\nnoise\n3. third"
    assert parse_subtasks(plan, 2) == ["first thing", "second thing"]
    assert parse_subtasks("no numbering at all", 3) == ["no numbering at all"]


async def test_flow_runs_all_phases_with_echo():
    events: list[FlowEvent] = []
    async for e in run_flow(EchoProvider(), "echo", "solve the task", workers=2):
        events.append(e)
    phases = [e.phase for e in events]
    assert phases[0] == "plan"
    assert phases.count("work") == 2
    assert "verify" in phases and "converge" in phases
    assert phases[-1] == "done"
    # BOP: no machinery in emitted events
    for e in events:
        assert "you are the" not in e.content.lower()


# --- offices -------------------------------------------------------------

async def test_office_run_checkpoints_state(tmp_path):
    office = OfficeDefinition(name="daily-digest", task="digest the day always thoroughly")
    runner = OfficeRunner(state_root=tmp_path / "state")
    run = await runner.run(office, "user_a", EchoProvider(), "echo")
    assert run.status == "done"
    state = run.state_path.read_text()
    assert "status: done" in state
    assert "## Autonomy" in state
    assert "### converge" in state
    # per-user directory isolation
    assert "user_user_a" in str(run.state_path)


def test_office_definitions_are_data(tmp_path):
    (tmp_path / "a.json").write_text(json.dumps({"name": "a", "task": "do a"}))
    (tmp_path / "b.json").write_text(
        json.dumps({"name": "b", "task": "do b", "schedule": "0 9 * * *", "workers": 3})
    )
    offices = load_offices(tmp_path)
    assert [o.name for o in offices] == ["a", "b"]
    assert offices[1].workers == 3


# --- skills --------------------------------------------------------------

SKILL_MD = """---
name: greeter
description: Greets the user
---
When asked to greet, run scripts/hello.sh.
"""


def make_skill(tmp_path):
    skill_dir = tmp_path / "greeter"
    (skill_dir / "scripts").mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(SKILL_MD)
    (skill_dir / "scripts" / "hello.sh").write_text('echo "hello from skill $1"\n')
    return skill_dir


def test_skill_loading(tmp_path):
    skill_dir = make_skill(tmp_path)
    skill = load_skill(skill_dir)
    assert skill.name == "greeter"
    assert skill.description == "Greets the user"
    assert "<untrusted_external_data>" in skill.prompt_context()

    # plugin.json layout is also discovered
    plugin = tmp_path / "plug"
    (plugin / "skills").mkdir(parents=True)
    (plugin / "plugin.json").write_text('{"name": "plug"}')
    inner = plugin / "skills" / "inner"
    inner.mkdir()
    (inner / "SKILL.md").write_text("---\nname: inner\n---\nbody")
    assert {s.name for s in load_skills(tmp_path)} == {"greeter", "inner"}


async def test_skill_script_sandbox(tmp_path):
    skill = load_skill(make_skill(tmp_path))
    result = await run_script(skill, "scripts/hello.sh", ["world"])
    assert result.exit_code == 0
    assert "hello from skill world" in result.output
    assert result.output.strip().startswith("<untrusted_external_data>")

    # path jail: escaping the skill dir is refused
    with pytest.raises(SkillExecutionError):
        await run_script(skill, "../outside.sh")

    # env scrub: service env never reaches scripts
    (skill.path / "scripts" / "env.sh").write_text('echo "key=[$ENCRYPTION_KEY]"\n')
    result = await run_script(skill, "scripts/env.sh")
    assert "key=[]" in result.output


async def test_skill_script_timeout(tmp_path):
    skill = load_skill(make_skill(tmp_path))
    (skill.path / "scripts" / "slow.sh").write_text("sleep 5\n")
    with pytest.raises(SkillExecutionError, match="timed out"):
        await run_script(skill, "scripts/slow.sh", timeout=0.5)


# --- MCP client ----------------------------------------------------------

def mcp_fake_server(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    rid = body["id"]
    match body["method"]:
        case "initialize":
            result = {"serverInfo": {"name": "fake"}, "capabilities": {}}
        case "tools/list":
            result = {"tools": [{"name": "add", "description": "adds", "inputSchema": {}}]}
        case "tools/call":
            args = body["params"]["arguments"]
            result = {"content": [{"type": "text", "text": str(args["a"] + args["b"])}]}
        case _:
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": rid,
                                             "error": {"message": "no such method"}})
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": rid, "result": result})


async def test_mcp_list_and_call(monkeypatch):
    # SSRF guard resolves the host; point it at a public address for the mock.
    monkeypatch.setattr("app.mcp_client.resolve_host", lambda host: ["93.184.216.34"])
    client = MCPClient(
        "https://mcp.test/rpc",
        client=httpx.AsyncClient(transport=httpx.MockTransport(mcp_fake_server)),
    )
    tools = await client.list_tools()
    assert tools[0].name == "add"
    output = await client.call_tool("add", {"a": 2, "b": 3}, consent=True)
    assert "5" in output
    assert output.startswith("<untrusted_external_data>")


async def test_mcp_requires_consent():
    # Consent is checked before any network call, so no SSRF resolution runs.
    client = MCPClient(
        "https://mcp.test/rpc",
        client=httpx.AsyncClient(transport=httpx.MockTransport(mcp_fake_server)),
    )
    with pytest.raises(ConsentRequired):
        await client.call_tool("add", {"a": 1, "b": 1}, consent=False)
