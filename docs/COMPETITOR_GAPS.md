# Verity v2 — Competitor Gap Backlog

Recurring audit per MASTER_PLAN §7, vs **Claude (claude.ai)**, **Manus**, **Flowith Neo**.
Snapshot 2026-07-20. Verity capabilities are code-verified (what's coded, not plan claims);
competitor capabilities cited in the working audit. Re-run this audit after each wave (the
"ralph loop") until the parity-critical gaps close.

## The load-bearing truth
Verity is a well-secured **multi-agent text orchestrator** with three gaps that don't appear
in the plan's optimism:
1. **Chat cannot use tools at all** — the provider abstraction yields only `Delta`/`Usage`.
   The MCP client and sandboxed skill executor are built and secured but the model can't call them.
2. **"Scheduled offices" is fiction** — `schedule_cron` is stored but nothing fires it.
3. **No web access, no artifacts/deliverables, no projects, no knowledge base** — chat renders
   markdown; sharing is a read-only transcript.

Distinctive assets worth keeping: confidence scoring, the consensus compute network, and the
tenant-isolation / BOP / injection-interceptor security posture.

## Prioritized backlog (value × buildability)

| # | Gap | Territory | Effort | Buildable now | Depends on |
|---|---|---|---|---|---|
| **G1** | **Agentic tool-use loop** — provider tool-calling + tool registry + chat call loop; wire existing MCP + skills as callable tools | brain | L | ✅ | — (foundation) |
| G2 | Web search + URL-fetch tools | brain | M | 🟡 search key (server-env) | G1 |
| G3 | Office scheduler that actually fires (cron ticker + Redis lease) | infra + brain module | M | ✅ | — |
| G4 | Artifacts panel + publish/share (reuse transcript-share pattern) | apps-web + gateway route | M | ✅ | — |
| G5 | Wide-research mode (parallel retrieve+synthesize; lift 4-worker cap) | brain | M | 🟡 | G1, G2 |
| G6 | Projects / workspaces (group convos+files+instructions; surface memory `scope`) | apps-web + brain | M | ✅ | — |
| G7 | Knowledge base ("Brain Garden") — doc ingestion → grounded RAG | brain + apps-web | M–L | ✅ (cognee/Qdrant present) | — |
| G8 | MCP/Skills management UI + memory viewer | apps-web + small brain routes | M | ✅ | — |
| G9 | Rich file output (docx/pptx/xlsx/pdf) + image gen as tools | brain | M | 🟡 (file yes after G1; image gen gated) | G1 |
| G10 | Gemini provider + formalize model-agnostic picker | brain | S | ✅ (user key) | — |
| G11 | Headless-browser fetch service (render JS pages → markdown) — buildable slice of browser-use | infra + brain tool | M | ✅ | — |
| G12 | Background/async run queue (Redis) so flows/offices run detached | infra | M | ✅ | — |

Excluded as pure gates: full computer-use VM fleet, native mobile (M8), live WAF/mTLS/pen-test
(M6), verity-9b training (§5 legal), Ollama Cloud house models (key gate).

## Build waves (clean territory separation; G1 first)

- **Brain wave 1:** G1 (foundation) + G10 (Gemini). Then **brain wave 2:** G2, G5, G9, G7 backend.
- **Infra wave:** G3 office scheduler, G11 browser-fetch service, G12 async queue.
- **Apps-web wave** (after WebGL immersive): G4 artifacts, G6 projects, G8 MCP/skills/memory UI, G7 KB surface.

Single most important: **G1**. Until the model can call tools, MCP + skills stay dead weight and
G2/G5/G9/G11/computer-use/file-output are all un-buildable.
