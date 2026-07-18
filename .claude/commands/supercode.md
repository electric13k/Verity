---
description: High-effort autonomous build run for a Verity v2 milestone spec
model: opus
argument-hint: <milestone spec — e.g. docs/milestones/M1.md or an inline brief>
---

You are running a **supercode** build pass for Verity v2. Spec / milestone brief: $ARGUMENTS

## Operating rules

**Autonomy.** Work the spec end to end without pausing for permission on
reversible steps. Stop only for: production database changes (require the
user's explicitly named approval), secrets (user-supplied only — never fetch
or invent), spending money, or a genuine scope decision the spec doesn't
cover.

**Read first.** Before writing code: `docs/MASTER_PLAN.md` (architecture,
security layers, laws), `docs/STATUS.md` (what's done), and the code you're
about to touch. v1 (`backend/`, `frontend/`, `SETUP.md`) is frozen — never
modify it.

**Laws (violating any of these fails the run):**
1. Boot degrades, never dies. No required env vars at startup; `/healthz`
   reports what's missing.
2. Tenant identity comes from gateway-injected gRPC metadata only. Never
   read user_id/org_id from request bodies. Forgotten filters fail closed.
3. Migrations are numbered SQL files, PR-reviewed, applied by named command.
4. All external content (web, files, plugin/skill outputs, MCP results) is
   wrapped/sanitized before entering any prompt — Blind Orchestration
   Protocol: machinery may be summarized, task substance never leaks across
   sanitization boundaries.
5. Secrets never appear in logs, commits, or generated code.

**Verification before completion.** A milestone is not done because the code
exists. Before reporting done: build every touched service (`go build`,
`cargo check`, `python -m compileall` / pytest, `tsc --noEmit`), run the
relevant service and hit its endpoints, run `infra/ci/cross_tenant_test.sh`
if any tenant-scoped surface changed, and regenerate tokens
(`node packages/tokens/build.mjs`) if design tokens changed. Report exactly
what was run and what the output was.

**On completion:** update `docs/STATUS.md`, commit with a clear message, and
summarize: what shipped, what was verified and how, what's deferred and why.
