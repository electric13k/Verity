# Verity v2 — Milestone Status

Tracking against [`MASTER_PLAN.md`](MASTER_PLAN.md) §7.

| # | Milestone | Status | Notes |
|---|---|---|---|
| M0 | Scaffold + tooling | ✅ done | repo tree, compose (pg/redis/qdrant/cognee), proto contracts, tokens package, `/supercode`, CI |
| M1 | Inter-service spine | ✅ done | gateway→brain→core gRPC hello-path verified E2E; request-id propagated in metadata; Go/Python stubs committed, Rust via tonic-build |
| M2 | Security plumbing | ✅ done | fail-closed Clerk JWT verify (JWKS) + dev-mode escape, tenant_ctx metadata injection, schema v1 migration, strict validation, per-user token buckets, AES-256-GCM vault (AAD = user_id); wrong-user corpus green. Live Clerk E2E awaits user keys (gate) |
| M3 | AI pipeline | ✅ done | providers (anthropic/openai-compat/ollama/house/echo-dev), chat SSE E2E with memory recall + learning loop, refiner, confidence, wrapUntrusted, Qdrant search with mandatory tenant filter. cognee = primary once its container is up (fallback store verified); live provider calls await user keys |
| M4 | UI assembly | ⬜ | design system, glass components, chat/flow/office UIs, branching, upload, PWA |
| M5 | Platform | ✅ done (backend) | flow engine (conductor/workers/inspector, converge + diverge-converge, BOP-sanitized events) via /v1/flows SSE; offices with STATE.md checkpoints + per-user caps; SKILL.md/plugin.json loader + sandboxed script executor (path jail, env scrub, timeout); MCP HTTP client with per-call consent; gateway security headers. Frontend surfaces await M4 |
| M6 | Hardening + deploy | ⏸ blocked on gates | gateway security headers + CSP already live (groundwork); Pages/VPC/WAF/mTLS need Cloudflare account + deploy targets (user gates) — **v1 retirement gate** |
| M7 | Compute network | 🟡 partial | schema ported (nodes/jobs/work_units/assignments/credit ledger, migration 0002) + redundancy-2 consensus verify with sybil-pair guard in core, unit-tested. Pending: node daemon, /compute page (frontend), live 2-node E2E |
| M8 | Apps | ⬜ | Tauri v2 desktop + mobile |
| M9 | Marketing | ⬜ | sizzles, screens, brand kit, launch landing |

## Open user gates (blocking future milestones, not current work)

- Clerk account + keys · Cloudflare account · Figma auth for the MCP token sync
- GPU rental + HF token (verity-9b) · Ollama Cloud key (house models)
- §5 training-data legality decision (plan assumes the safe/open path)
- Signing certs + store accounts (M8) · counsel review of legal pages

## Decisions

- **Memory stack (user, 2026-07-18):** cognee (self-hosted from github.com/topoteretes/cognee) is the primary brain engine; the durable fallback is an **Obsidian-compatible markdown vault** (`OBSIDIAN_VAULT_PATH`) — one note per memory with YAML frontmatter, browsable/editable directly in Obsidian. Postgres `memories` table remains as an optional index, not the fallback.

## Notes

- Dev container Python is 3.11; plan targets 3.12 — `requires-python = ">=3.11"` for now, bump at Stage B deploy.
- The v1 prototype is not part of this branch — it lives untouched on `main` until the M6 retirement gate. v2 code never copies from it.
