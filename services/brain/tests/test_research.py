"""G5 wide-research: parallel retrieve+synthesize fan-out converges to a cited
report, with the worker count lifted above the base flow's 4-cap but bounded.
Uses fake providers + an injected registry (no network).
"""

import pytest

from app.flows.research import (
    RESEARCH_MAX_WORKERS,
    build_research_registry,
    parse_subquestions,
    run_research_flow,
)
from app.providers.base import ChatMessage, Delta, Provider, ToolCall, Usage
from app.tenant import TenantCtx
from app.tools.base import Tool, ToolResult, prompt_safe
from app.tools.registry import ToolRegistry

TENANT = TenantCtx(user_id="user_a")


async def collect(agen):
    return [e async for e in agen]


class FakeSearchTool(Tool):
    name = "web_search"
    description = "fake"
    parameters = {"type": "object", "properties": {"query": {"type": "string"}}}

    def __init__(self, sink):
        self._sink = sink

    async def run(self, args, tenant):
        self._sink.append({"url": "https://example.com/a", "title": "Source A"})
        return ToolResult(prompt_safe("evidence about the topic", source="web_search"))


class ResearchProvider(Provider):
    """Scripts the whole research flow by matching on role/system content."""

    name = "research-fake"
    supports_tools = True

    async def stream_chat(self, messages, model, tools=None):
        sys = " ".join(m.content for m in messages if m.role == "system")
        has_tool_result = any(m.role == "tool" for m in messages)
        if "planning a research investigation" in sys:
            # 10 sub-questions offered; the runner must cap the fan-out.
            yield Delta("\n".join(f"{i}. sub question {i}" for i in range(1, 11)))
            yield Usage()
        elif "reviewing research findings" in sys:
            yield Delta("APPROVED — coherent and supported")
            yield Usage()
        elif "Merge the research findings" in sys:
            yield Delta("# Final Report\n\nSynthesis of all findings.")
            yield Usage()
        elif "Write your findings summary now" in sys or has_tool_result:
            yield Delta("findings: the topic is well understood")
            yield Usage()
        else:  # first subagent turn → call the search tool
            yield Delta("searching ")
            yield ToolCall(id="c1", name="web_search", arguments={"query": "q"})
            yield Usage()


class ToollessProvider(Provider):
    name = "toolless"
    supports_tools = False

    async def stream_chat(self, messages, model, tools=None):
        sys = " ".join(m.content for m in messages if m.role == "system")
        if "planning a research investigation" in sys:
            yield Delta("1. only sub question")
        elif "Merge the research findings" in sys:
            yield Delta("Converged report without tools")
        else:
            yield Delta("a direct answer")
        yield Usage()


async def test_wide_research_converges_with_bounded_workers():
    sink: list = []
    registry = ToolRegistry([FakeSearchTool(sink)])
    events = await collect(
        run_research_flow(
            ResearchProvider(), "m", "Investigate the topic thoroughly.", TENANT,
            workers=10, registry=registry, sink=sink,
        )
    )
    phases = [(e.role, e.phase) for e in events]

    # Fan-out is lifted above the base 4-cap but bounded at RESEARCH_MAX_WORKERS.
    work = [e for e in events if e.phase == "work"]
    assert len(work) == RESEARCH_MAX_WORKERS == 8

    assert ("conductor", "plan") in phases
    assert any(role == "inspector" and phase == "verify" for role, phase in phases)
    assert phases[-1] == ("flow", "done")

    converge = [e for e in events if e.phase == "converge"]
    assert len(converge) == 1
    report = converge[0].content
    assert "Final Report" in report
    # Cited report: sources collected from the (fake) search tool are appended.
    assert "## Sources" in report and "https://example.com/a" in report


async def test_wide_research_degrades_toolless_provider():
    events = await collect(
        run_research_flow(ToollessProvider(), "m", "Study X.", TENANT, workers=3)
    )
    converge = [e for e in events if e.phase == "converge"]
    assert converge and "Converged report without tools" in converge[0].content
    assert events[-1].phase == "done"


def test_parse_and_registry():
    subs = parse_subquestions("1. a\n2. b\n3. c", 2)
    assert subs == ["a", "b"]
    reg = build_research_registry([])
    assert {"web_search", "web_fetch", "kb_search"} <= set(reg.names())
