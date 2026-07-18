# Verity v2 — Master Plan

**Status: PLAN ONLY. Nothing here is built. v1 stays untouched at `verity-latest/Verity` until v2 reaches feature parity (Milestone 6 gate).**

Date: 2026-07-18. Author: Fable 5 orchestrator session.

---

## 0. What this is

Fresh build of the Verity app. Concepts survive; code does not. Everything learned in v1 (below) is carried as design law, not as copied code.

### Carried concepts (from v1, proven)
| Concept | v1 verdict | v2 treatment |
|---|---|---|
| Verity Chat | works; Claude-parity UX done | rebuild on new stack, keep UX patterns (stop/regen/edit/branch) |
| Verity Flow | conductor/worker/inspector roles + BOP | port role architecture as data-driven flow definitions |
| Verity Offices | scaled CAHSI, STATE.md checkpointing, autonomy preamble | port; offices = scheduled flows with decomposition |
| Brains | tag funnel + importance threshold; main + project scopes; cognee opt-in dual-write | cognee becomes **primary** memory engine, Postgres vault the fallback (v1 had it inverted) |
| Continuous learning | learnFromExchange after chat/flow; swarm-routed extraction | port as-is; it's the "self-learning algorithm" seed |
| Compute network | redundancy+consensus only; no zk, no training on volunteers; credits ledger; sybil pair guard | port schema + verify logic; nexus.xyz itself is a zkVM prover network, NOT usable for LLM inference — build own (already legal-clean: BOINC-style volunteer model) |
| Blind Orchestration Protocol | sanitize machinery leaks, never task substance | port; extend to plugin/skill outputs |
| Prompt refiner v2 | complexity rater, structured template, tone profiles | port as "prompt optimizer" feature |
| Confidence scoring | 0-100 + RRR protocol | port |
| wrapUntrusted | all external content wrapped before prompts | becomes gateway-level middleware |
| Qwythos training | `empero-ai/Qwythos-9B-v2` base, QLoRA, official repos only | port plan; see §7 model layer |

### v1 lessons that are now law
- One empty env var killed the entire app for weeks ("Can't reach the Verity server"). v2: **boot must degrade, never die** — server starts with missing optional config, `/healthz` reports exactly what's missing.
- user_id scoping in service-role queries IS the security boundary — v2 moves this to a gateway that injects tenant context so a forgotten filter fails closed, not open.
- Refraction glass needs a chromatic backdrop; flat backgrounds make liquid glass invisible. Light mode ships with a gradient-mesh ground from day one.
- Production DB changes need explicitly named user approval. Migrations in v2 are PR-reviewed files, applied by named command.
- Secrets are user-supplied, never fetched or invented by agents.

---

## 1. Architecture

Target topology = the user-approved diagram (Cloudflare WAF → public subnet [static frontend + Go gateway] → security boundary → private subnet [Python AI brain ↔ Rust core, Postgres/Redis, Qdrant]).

**Ponytail correction, staged honestly:** a 4-language microservice mesh on day one is how solo projects die. Same target, three stages — each service splits only when it earns it:

### Stage A — "one box, real boundaries" (Milestones 1-4)
```
verity-v2/
  apps/
    web/          Next.js 15 + Tailwind v4 (static export capable)
  services/
    gateway/      Go (Fiber): auth, validation, rate limit, SSE/WS fan-out, proxy
    brain/        Python (FastAPI): orchestration, flows, offices, cognee, providers
    core/         Rust (axum): vector search proxy (Qdrant), heavy compute, verify/consensus
  packages/
    proto/        gRPC .proto contracts (single source of truth between the three)
    tokens/       design tokens (JSON → CSS vars + Figma sync)
  infra/
    docker/       compose: postgres, redis, qdrant, cognee
    migrations/   SQL, numbered, PR-reviewed
```
All services run via one `docker compose up`. gRPC between gateway↔brain↔core from day one (contract discipline is cheap now, expensive later). mTLS deferred — localhost/compose network in Stage A. `// ponytail: mTLS at Stage C, certs via step-ca or Cloudflare origin certs`.

### Stage B — split deploy (Milestone 5)
Frontend → Cloudflare Pages. Gateway → public VM/container. Brain+core+DBs → private network (no public IPs). Managed Postgres (Supabase keeps working here) or RDS.

### Stage C — hardening (Milestone 6)
VPC split public/private, Cloudflare WAF + rate rules, mTLS on all internal gRPC, CSP enforced, pen-test pass.

### Stack decisions (locked unless user objects)
| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15, React 19, Tailwind v4, TypeScript | static-export for Pages; app router for transcript/share pages |
| Gateway | Go 1.23 + Fiber v3 | user-specified; right tool for auth/ratelimit/streaming fan-out |
| AI brain | Python 3.12 + FastAPI + Pydantic v2 | cognee is Python-native; LLM ecosystem lives here |
| Core engine | Rust (axum + tonic) | consensus verify, embedding pipelines, Qdrant client |
| Vector DB | Qdrant | Rust-native, payload-filter multi-tenancy built in |
| Primary DB | Postgres (Supabase in dev/Stage A) | keep pgvector as vault fallback |
| Cache/queues | Redis | rate-limit buckets, office job queues, SSE resume |
| Auth | Clerk | user-specified security stack; JWT in HttpOnly Secure SameSite=Strict cookie, verified in Go middleware; Supabase Auth is fallback option |
| Memory | cognee (self-hosted docker) | primary brain engine; dataset-per-user isolation pattern from v1 port |
| Edge | Cloudflare: DNS, WAF, Pages, Turnstile | user-specified |

---

## 2. Security (backend + security perfection FIRST — build order reflects this)

Five layers, per the approved plan, corrected and made concrete:

**L1 Browser:** HttpOnly/Secure/SameSite=Strict session cookie (Clerk), zero tokens in JS-readable storage. CSP (corrected syntax):
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  connect-src 'self' https://api.verity.app wss://api.verity.app https://*.clerk.accounts.dev;
  img-src 'self' data: blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'
```
DOMPurify on every AI-rendered markdown block. Streamed chunks sanitized post-parse, not per-chunk.

**L2 Gateway (Go):** go-playground/validator structs on every payload; unknown fields rejected. Token-bucket rate limits per user-id in Redis (chat, flow, office, upload each have own bucket). JWT verify in middleware; expired/tampered = drop before proxy. Body size caps. Request-id propagation.

**L3 Transport:** gRPC everywhere internal; mTLS at Stage C. Gateway injects validated `tenant_ctx` (user_id, org_id) into gRPC metadata — brain/core NEVER read tenant identity from request bodies. Forgotten filter fails closed.

**L4 Brain (Python):** prompt-injection interceptor (LLM Guard; NeMo Guardrails if LLM Guard insufficient) on every user string + every retrieved/external content block, layered on v1's wrapUntrusted pattern. User provider keys AES-256-GCM at rest (port v1 crypto, key from KMS/env). Secrets never logged; structured logging with redaction filter.

**L5 Vector (Rust/Qdrant):** every query carries mandatory payload filter `user_id == tenant_ctx.user_id`; filter constructed in core service from gRPC metadata only. Cross-tenant test in CI (authenticated-as-wrong-user corpus from v1 phase 7d).

Plus: dependency audit in CI (npm audit / pip-audit / cargo audit), migration review gate, per-user office concurrency caps (v1 lesson).

---

## 3. Product surface (feature inventory)

Everything v1 had + the new asks. Grouped by milestone weight:

**Core (M3-M4):** Chat (SSE streaming, stop/regen/edit, history windowing, auto-naming, confidence chips) · Flow (conductor/workers/inspector/helpers, CAAI converge + diverge-converge, CAHSI, auto/manual flow pick) · Offices (scheduled, STATE checkpointing, autonomy preamble, per-user caps) · Brains (cognee primary: main brain + project sub-brains, tag funnel, compression pipeline max-5-file digests; continuous learning loop) · Prompt optimizer (refiner v2 port) · File upload (markitdown MCP already configured — gateway accepts file, brain calls markitdown, result enters context sanitized) · Transcript views (port) · Chat branching: **any chat message can branch into a Flow or Office** — branch carries conversation context as the task brief; new DB relation `branches(chat_msg_id → run_id)`.

**Platform (M5):** Plugin & skill support — adopt **Claude Code plugin/skill format as the native format** (SKILL.md + frontmatter; plugin.json) so the existing ecosystem (Claude skills, and Manus/Perplexity-style computer-use skills where licenses allow) loads directly; skills run in brain-side sandboxed executor with BOP sanitization on outputs · MCP client support — users connect MCP servers (stdio via desktop app, SSE/HTTP via web); tools surface in chat/flow with per-tool consent · Self-learning — learnFromExchange + periodic brain compression + preference profiles feeding the refiner.

**Network (M7):** Scattered compute — port v1 schema (nodes, work units, sybil-pair assignments, credits ledger, jobs), redundancy-2 consensus, SWARM_INTERNAL routing for house scalar calls. Own network, not nexus (nexus = zkVM prover, wrong tech, and their client is login-gated/proprietary).

**Apps (M8):** Web (PWA, exists from M4) · Desktop win/linux/mac: **Tauri v2** (Rust core — matches stack, tiny binaries; gives stdio MCP support) · Mobile android/iOS: Tauri v2 mobile targets first (one codebase); React Native fallback only if Tauri mobile blocks. Store fees/certs = user gate.

---

## 4. Brand & design system

### Palette — "Gallery Matcha" (premium, warm-gallery, zero cyberpunk)
Keeps v1's matcha equity, elevates it to gallery/atelier register. Light AND dark first-class.

| Token | Hex (light) | Hex (dark) | Role |
|---|---|---|---|
| `porcelain` | #F6F4EE | #101210 | canvas |
| `bone` | #FDFCF8 | #181B17 | raised surface |
| `ink` | #1C1E1A | #EFEDE4 | primary text |
| `matcha` | #56694B | #A8C48E | brand accent, actions |
| `chai` | #A97E4F | #DFB98A | warm secondary, highlights |
| `brass` | #8C7349 | #C9AE7C | premium metal detail — hairlines, dividers, active glass edges |
| `oxblood` | #7E3B30 | #D08170 | destructive/error only |
| `fog` | #DEDCD0 | #2A2D27 | borders, disabled |

Glass: chromatic gradient-mesh grounds in BOTH themes (v1 light-mode lesson); refraction filter + tinted edge + prism fringes; brass edge on active glass. Glow is rationed: **glow = hierarchy signal only** (one glowing element per view max — the current focus of attention).

### Type
- Display: **Fraunces** (variable, optical sizing — premium editorial serif, not scifi)
- Body/UI: **Geist** (keep v1 self-hosted discipline)
- Data/mono: **Geist Mono**

### Design rules (user's, made enforceable)
1. Space has hierarchy — 4/8/12/18/28/44 scale; section spacing ≥ 2× component spacing; density increases with data, not decoration.
2. Motion has reason — every animation maps to a state change or spatial relation; GSAP + Lenis smooth scroll for landing; motion.dev/react-spring for in-app micro; `prefers-reduced-motion` honored globally. No idle loops except ambient ground (GPU-cheap, pausable).
3. Grids not overused — editorial asymmetry on landing/marketing; grids only where content is truly tabular.
4. Glow does hierarchy's job — see palette; never decorative neon.
5. Dark + light equal citizens — every token has both values from day one; CI screenshot both.

### Figma pipeline (liquid glass source of truth)
`packages/tokens` JSON → CSS vars + Tailwind theme + Figma variables via Figma MCP (needs your Figma auth — currently unauthenticated in this environment). Glass components designed in Figma (reference: the liquid-glass community file already bookmarked), implemented once in `apps/web/components/glass/*`, never restyled ad-hoc.

### Reference library (curated from your list — what each is FOR)
Motion: gsap.com + ScrollTrigger (landing choreography), lenis (smooth scroll), anime.js (SVG micro), motion.dev + react-spring (in-app), vanta (ambient grounds — audit perf), react-bits (patterns). Visual refs: sondaven.com, framer galleries, mobbin.com (app-screen patterns), designengineer.io, componentry, getlayers, morpho particle animations (hero particles), haikei (mesh/blob assets). Icons: one library only — Phosphor or Lucide, weight-consistent. Gen assets: nano banana / HF / Veo 3 for marketing imagery + product sizzles (M9), never for in-app UI chrome.

---

## 5. Model layer

- **User-key providers:** port v1's 8 (Anthropic, OpenAI, etc.), AES-256-GCM storage.
- **House providers (Verity-side):** Ollama Cloud via `OLLAMA_CLOUD_API_KEY` server env — the v1 agent's half-done work is a design spec now: availability = env-gated, per-user daily cap, no user config row, "provided by Verity" badge.
- **verity-9b:** Qwythos-9B-v2 base (official empero-ai repo ONLY), QLoRA on 24GB GPU (user gate: GPU + HF token). Training data: Verity structured tasks + system-prompt-style behavioral data. ⚠ Legal note, full prose: training on Anthropic's Fable 5 system prompt or other labs' prompts/outputs may violate their terms of service; "system prompts from Kimi K2.6 or models <1 month old" — same issue, plus recency doesn't change licensing. Safe path: use OPEN system prompts (Apache/MIT-licensed agent prompts, published open datasets like Hermes/Tulu SFT mixes) and write Verity's own system-prompt corpus in the same spirit. Flagged for your decision; plan assumes the safe path.
- **Swarm serving:** GGUF via Ollama nodes, temp-0 seed-7, consensus verify (v1 port).

## 6. Marketing & legal

- Legal (strong, before launch): ToS + Privacy (port v1 pages, counsel review = user gate), GDPR/DPDP data-subject flow, model-provider ToS compliance (see §5), plugin marketplace terms, compute-volunteer agreement (device wear, no warranty, credits ≠ currency), COPPA age gate.
- Marketing (M9): app screens (mobbin-informed), product sizzle videos (Veo 3 + screen capture), brand identity kit (palette/type/glass motif via brandkit skill), landing rebuild on v2 design system, password-security explainer graphics (Clerk flow visual).

---

## 7. Execution roadmap — phase → audit → ralph-loop, every milestone

Structure per milestone: **BUILD (opus supercode) → AUDIT (fresh-context reviewer agents: security + ponytail + feature-parity) → RALPH LOOP (iterate until audit green) → GATE (user checkpoint)**.

Tooling to create at M0:
- `/supercode` command (`.claude/commands/supercode.md`): opus, effort high/xhigh, autonomy preamble, verification-before-completion, BOP discipline, per-milestone spec as argument.
- Competitor gap audit (recurring, M4/M6/M8): compare against Claude (web app), Flowith Neo, Manus — feature matrix, missing items become backlog. (Live research at audit time, not now — they ship weekly.)

| # | Milestone | Contents | Gate |
|---|---|---|---|
| M0 | Scaffold + tooling | repo per §1, compose (pg/redis/qdrant/cognee), proto contracts, tokens package, /supercode, CI (typecheck+audits+cross-tenant tests) | — |
| M1 | Inter-service spine | Go↔Python↔Rust gRPC hello-path, healthz-degrades-not-dies, structured logs | services talk |
| M2 | Security plumbing | Clerk auth end-to-end (cookie→Go verify→tenant_ctx), Postgres schema v1, validation structs, rate limits, AES key vault | wrong-user tests pass |
| M3 | AI pipeline | providers + house Ollama Cloud, chat SSE, cognee brains + learning loop, refiner, confidence, Qdrant tenant filters | chat E2E with brain recall |
| M4 | UI assembly | design system + glass components (Figma sync), chat/flow/office UIs, branching, transcripts, upload (markitdown), PWA | parity audit vs v1 |
| M5 | Platform | plugins/skills executor, MCP client, flow/office data-driven definitions | 3rd-party skill runs sandboxed |
| M6 | Hardening + deploy | Stage B/C: Pages, VPC, WAF, mTLS, CSP, pen-test corpus, legal pages | security audit green = **v1 retirement gate** |
| M7 | Compute network | port swarm, node daemon, credits, /compute page | 2-node consensus E2E |
| M8 | Apps | Tauri v2 desktop ×3 + mobile ×2, stdio MCP in desktop | installers signed (user gate: certs) |
| M9 | Marketing | sizzles, screens, brand kit, launch landing | launch |

Est. calendar (solo + agent fleet): M0-M2 ≈ 1 wk · M3-M4 ≈ 2 wk · M5-M6 ≈ 1.5 wk · M7-M9 ≈ 2 wk.

### User gates (nothing moves without you)
1. Approve this plan (or edit).
2. Clerk account + keys · Cloudflare account · Figma auth for MCP.
3. GPU rental + HF token (verity-9b) · Ollama Cloud key (house models).
4. §5 training-data legality decision.
5. Signing certs + store accounts (M8) · counsel review (legal).
