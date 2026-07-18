# Verity

Calm, precise, trustworthy AI orchestration. This repository contains the **Verity v2** monorepo (in progress, built per [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md)) alongside the untouched v1 prototype.

## Layout

```
apps/
  web/          Next.js 15 + React 19 + Tailwind v4 frontend (static-export capable)
services/
  gateway/      Go (Fiber): auth, validation, rate limiting, SSE/WS fan-out, proxy
  brain/        Python (FastAPI): orchestration, flows, offices, memory (cognee), providers
  core/         Rust (axum): vector search proxy (Qdrant), heavy compute, verify/consensus
packages/
  proto/        gRPC .proto contracts — single source of truth between the three services
  tokens/       design tokens (JSON → CSS variables, light + dark)
infra/
  docker/       docker compose: postgres, redis, qdrant, cognee
  migrations/   SQL migrations — numbered, PR-reviewed, applied by named command only
  ci/           CI helper scripts (cross-tenant tests, etc.)
docs/
  MASTER_PLAN.md   the v2 master plan (architecture, security, roadmap)
  STATUS.md        live milestone status

backend/ frontend/ SETUP.md    ← v1 prototype, frozen. Do not modify (retirement gate: M6).
```

## Quickstart (Stage A — one box)

```bash
# infra (postgres, redis, qdrant, cognee)
docker compose -f infra/docker/compose.yaml up -d

# design tokens (generated, git-ignored — required before running web)
node packages/tokens/build.mjs

# gateway
cd services/gateway && go run .

# brain
cd services/brain && pip install -e . && uvicorn app.main:app --port 8100

# core
cd services/core && cargo run

# web
cd apps/web && npm install && npm run dev
```

Every service starts with missing optional config — **boot degrades, never dies**. Each exposes `/healthz` reporting exactly which config is absent.

## Laws (from v1, non-negotiable)

1. Boot must degrade, never die — a missing env var must never take the app down.
2. Tenant identity is injected by the gateway (`tenant_ctx` in gRPC metadata); services never read it from request bodies. A forgotten filter fails **closed**.
3. Migrations are PR-reviewed files, applied by explicitly named command.
4. Secrets are user-supplied; agents never fetch or invent them. Secrets are never logged.
5. All external content is wrapped/sanitized before entering a prompt (gateway-level middleware).
