# Verity v2 — Status

**Snapshot: 2026-07-23.** This file is the honest source of truth for what is
built, what is partial, and what comes next. Pushed directly to `main` at the
user's request; the full v2 build now lives on `main` (previously only on
`claude/fable-opus-orchestrator-5iy9cz`, PR #2).

Tracking against [`MASTER_PLAN.md`](MASTER_PLAN.md). Companion docs:
[`API_SURFACE.md`](API_SURFACE.md) · [`COMPETITOR_GAPS.md`](COMPETITOR_GAPS.md)
· [`SCALE_BACKLOG.md`](SCALE_BACKLOG.md) · [`DEPLOY.md`](DEPLOY.md).

## Verification at this push
All blocking CI gates were run locally and are green at the pushed commit:

| Gate | Command | Result |
|---|---|---|
| Web | `tsc --noEmit` (typecheck) | ✅ clean |
| Gateway | `go build ./...` + `go vet ./...` | ✅ clean |
| Brain | `from app.main import app` + `pytest` | ✅ import ok · **161 passed** |
| Core | untouched this push (`cargo check`) | ✅ n/a |

## Milestones (MASTER_PLAN §7)

| # | Milestone | Status | Notes |
|---|---|---|---|
| M0 | Scaffold + tooling | ✅ done | monorepo, compose (pg/redis/qdrant/cognee), proto contracts, tokens package, CI |
| M1 | Inter-service spine | ✅ done | gateway→brain→core gRPC verified E2E; request-id in metadata; Go/Python/Rust stubs |
| M2 | Security plumbing | ✅ done | fail-closed JWT verify (Clerk **and Supabase**, JWKS + HS256), tenant_ctx from metadata only, schema v1, strict validation, per-user token buckets, AES-256-GCM vault (AAD=user_id); cross-tenant corpus green |
| M3 | AI pipeline | ✅ done | providers (anthropic/openai-compat/ollama/gemini/house/echo-dev), chat SSE with memory recall + learning loop, refiner, confidence, wrapUntrusted+BOP, L4 injection interceptor, Qdrant mandatory tenant filter; live provider calls need user keys |
| M4 | UI assembly | ✅ done | Next 15 / Tailwind v4 glass design system (Gallery Matcha, light+dark), app shell, streaming chat, flows/offices/compute/transcripts/settings, branching, upload, PWA; live-API integration; perf pass; **WebGL ambient ground**; **Supabase auth UI**; optimistic mutations; **public marketing landing** |
| M5 | Platform | ✅ done (backend) | flow engine (conductor/workers/inspector, converge + diverge-converge), offices with STATE checkpoints + per-user caps, SKILL/plugin loader + sandboxed executor, MCP client with per-tool consent + SSRF guard |
| M6 | Hardening + deploy | 🟡 buildable, not live | per-service Dockerfiles, prod compose (public/private/egress split), Cloudflare WAF+CSP templates, mTLS cert tooling, deploy runbook; gateway `/metrics`, WS fan-out, Redis cache. **Live WAF/VPC/mTLS gated on Cloudflare + cloud accounts** |
| M7 | Compute network | ✅ done | node daemon (Rust), Postgres coordinator, redundancy-2 consensus + sybil-pair guard, credits ledger; live 2-node E2E verified |
| M8 | Apps (Tauri v2) | ⬜ not started | desktop + mobile shells |
| M9 | Marketing | 🟡 partial | landing page live (see M4); sizzles / brand kit / full multi-page site pending |

## Competitor-gap backlog (`COMPETITOR_GAPS.md`)

| Gap | Status |
|---|---|
| G1 agentic tool-use loop | ✅ done (backend) — provider tool-calling + registry + model→tool→model loop; MCP + skills callable; results wrapUntrusted-wrapped; bounded |
| G2 web search + URL fetch | ✅ done (backend) |
| G3 office scheduler (cron + Redis lease) | ✅ done — exactly-once CAS on `next_fire_at`; migration 0004 |
| G4 artifacts panel + publish | ⬜ not started (frontend) |
| G5 wide-research mode | ✅ done (backend) |
| G6 projects / workspaces | ⬜ not started |
| G7 knowledge base (RAG) | ✅ done (backend); frontend surface pending |
| G8 MCP/skills mgmt UI + memory viewer | ⬜ not started (frontend) |
| G9 rich file output (docx/pptx/xlsx/pdf) | ✅ done (backend); image-gen gated |
| G10 Gemini provider | ✅ done |
| G11 headless-browser fetch service | ✅ done — `services/fetch/` render-to-markdown, SSRF-guarded, 66 tests |
| G12 background async run queue | ✅ done — Redis queue + worker; cooperative-drain shutdown |

## Anti-tamper: server-authoritative entitlements + metering
User requirement: *"local + database data verification — nobody should change the
code on their PC and get free usage."* **Status: 🟡 implemented, enforcing in
code, needs live integration test.**

- **Migration `0005_entitlements.sql`** — `plans`, `user_entitlements`, `usage_ledger`.
- **Gateway `entitlements.go`** — fail-closed middleware, registered as
  `[rateLimit, entitlement("messages"), handler]` on `/v1/chat`. Plan + usage are
  **never** read from the request body/headers; identity is the JWT-verified
  session passed only as gRPC metadata. Idempotency-Key is scoped to
  `user:metric:key` so it can't collide across users or let one client spend as
  another. A check that can't complete refuses the action (never un-metered).
- **Brain `platform_server.py`** — `CheckEntitlement` (atomic check + reserve
  against the ledger) and `GetEntitlements` (read-only, display only).
- **Brain `grpc_server.py`** — house-model daily-cap reservation on chat + flow,
  idempotent on request id.
- **Why tampering buys nothing:** every gated action is re-decided server-side
  against the DB, keyed to the verified user; editing the browser bundle changes
  no quota.
- **Remaining:** apply 0005 to the DB and add an end-to-end integration test
  (reserve → deny at limit → idempotent retry); surface `GetEntitlements` in the
  settings UI; extend the gate beyond `messages` to other metered actions.

## Security posture (five layers, honest)
L1 CSP + DOMPurify (+ WAF template) · L2 validation + rate limits + JWT verify
(iss/azp) + entitlement gate · L3 gRPC (mTLS tooling ready, wiring behind
`VERITY_MTLS`) · L4 injection interceptor + BOP + AES vault · L5 Qdrant tenant
filter (Rust, fail-closed) with cross-tenant CI corpus. Live WAF / VPC / mTLS are
staged to deploy (account gates).

## Systems / scale-out (`SCALE_BACKLOG.md`)
In the build: rate limiting, RPC (gRPC), caching (Redis + CDN template),
encryption (AES + TLS/mTLS tooling), Postgres + indexing + pagination,
containerization, CI/CD, structured logging, WebSockets, async queue.
Staged/gated: cloud VPC, WAF, load balancer, serverless edge, S3 object storage,
TensorRT/quantization. Post-launch (measured load only): Kubernetes, brokered
queues (SQS/RabbitMQ/Kafka), sharding/partitioning, DynamoDB, OpenTelemetry SLOs,
read replicas, long/short-polling fallback, multi-AZ HA.

## What's incomplete (carry-forward)
1. **Anti-tamper integration** — apply 0005 + E2E test; usage display in settings;
   widen metered surface (see above).
2. **Frontend expansion** — G4 artifacts, G6 projects, G8 MCP/skills/memory UI,
   G7 KB surface; break the single landing into the full multi-page site (the
   marketing CSS already ships styles for docs/changelog/about/pricing pages).
3. **M8 Tauri v2** desktop + mobile shells.
4. **M9 marketing** sizzles + brand kit.
5. **Live deploy (M6)** — WAF/VPC/mTLS once Cloudflare + cloud accounts exist.
6. **Live provider/model keys** — provider calls, cognee-hosted, verity-9b serving.

## Next steps (ordered)
1. Apply `0005_entitlements.sql` to Supabase; add the entitlement E2E test; wire
   `GetEntitlements` into settings so the user sees plan + remaining quota.
2. Build the apps-web wave (G4 artifacts → G6 projects → G8 management UI),
   reusing the transcript-share and optimistic-mutation patterns.
3. Split the marketing landing into routed pages (`/about`, `/pricing`, `/docs`)
   using the already-authored `marketing.css` sections.
4. Re-run the competitor-gap audit (ralph loop) to confirm parity after the
   apps-web wave.
5. M8 Tauri scaffolding; M9 brand kit.

## Open user gates (block future work, not current)
- Clerk/Supabase keys for live auth E2E · Cloudflare account · cloud VPC/deploy
  targets · GPU + HF token (verity-9b) · Ollama Cloud key (house models) ·
  signing certs + store accounts (M8) · counsel review of legal pages.

## Decisions
- **Memory (2026-07-18):** cognee (in-process library, `add→cognify→search`,
  dataset-per-user) is primary; durable fallback is an Obsidian-compatible
  markdown vault (`OBSIDIAN_VAULT_PATH`), then in-process. Boot degrades, never
  dies.
- **Auth:** Supabase (JWKS + HS256) is the live path (no Clerk keys); Clerk verify
  retained. Auth UI degrades to open app when unconfigured.
- **Model layer (§5):** verity-9b trains on the Verity-original corpus (safe/legal
  path); no proprietary lab-prompt text is copied.
- **Routing:** public marketing at `/` (its own route group + isolated CSS); the
  signed-in workspace moved to `/app/*`; shared transcripts stay standalone at
  `/t/*`.
