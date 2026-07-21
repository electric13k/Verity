# Verity v2 — Deploy runbook (Stage A → B → C)

How Verity promotes from one-box dev to a hardened public/private split. This
is the operational companion to `docs/MASTER_PLAN.md` §1 (staging) and §2
(security layers). Everything here is config-only and reversible; the live
cutover steps are **user-gated** (Cloudflare + cloud accounts + secrets are
user-supplied — plan law).

Guiding law throughout: **boot degrades, never dies.** No service requires an
env var to start; each `/healthz` reports what is missing. A promotion never
depends on a service being fully configured — it depends on the topology being
correct.

---

## The three stages

| Stage | Milestones | Topology | This repo's artifacts |
|---|---|---|---|
| A | M1–M4 | One box, `docker compose -f infra/docker/compose.yaml up`. gRPC over the compose network, plaintext, localhost binds. | `infra/docker/compose.yaml` |
| B | M5 | Split deploy: frontend → Cloudflare Pages; gateway → public container; brain/core/DBs → private network (no public IPs); managed Postgres/Redis optional. | `infra/docker/compose.prod.yaml`, `infra/cloudflare/` |
| C | M6 | Hardening: public/private network split enforced, Cloudflare WAF + per-route rate limits, CSP enforced, internal mTLS on all gRPC. | `infra/cloudflare/*`, `infra/tls/*`, `_headers.template` |

---

## Stage A → B promotion

**What changes:** the single box becomes a public edge + a private mesh, and the
frontend leaves the origin for Cloudflare Pages.

1. **Images.** Build the four services (contexts differ — see each Dockerfile
   header comment):
   ```bash
   docker build -f services/gateway/Dockerfile -t verity/gateway .
   docker build -f services/core/Dockerfile   -t verity/core   .
   docker build -f services/node/Dockerfile   -t verity/node   .
   docker build -f services/brain/Dockerfile  -t verity/brain  services/brain
   ```
   (gateway/core/node build from the **repo root** — they reach
   `packages/proto`; brain builds from **`services/brain`** — it is self-contained.)

2. **Env.** `cp infra/docker/.env.prod.example infra/docker/.env.prod` and fill
   it. All values are optional (degrade if empty); secrets are user-supplied and
   never committed. Point `DATABASE_URL`/`REDIS_URL`/`QDRANT_URL` at managed
   services, OR plan to run the self-hosted `data` profile (below).

3. **Bring up the private mesh + public gateway:**
   ```bash
   docker compose -f infra/docker/compose.prod.yaml --env-file infra/docker/.env.prod up -d
   # self-hosted data plane instead of managed services:
   #   ... --profile data up -d      (requires POSTGRES_PASSWORD set)
   ```
   Only the gateway publishes a port. brain/core/node/postgres/redis/qdrant/cognee
   sit on the `internal: true` private network with **zero** published ports —
   unreachable from the host or internet. App services additionally join an
   outbound-only `egress` bridge so brain can reach LLM providers and a managed
   Postgres (a real private subnet with NAT — no inbound public IP).

4. **Frontend → Pages.** Deploy `apps/web` (static export, `npm run build` →
   `out`) to Cloudflare Pages (`infra/cloudflare/pages.tf`, or wrangler direct
   upload). Set `NEXT_PUBLIC_GATEWAY_URL` to the gateway's public origin.

5. **Front the gateway with Cloudflare.** Either a Cloudflare Tunnel
   (`cloudflared` sidecar, bind `GATEWAY_BIND=127.0.0.1` so nothing is exposed
   on the host) or a load balancer holding a Cloudflare Origin CA cert with SSL
   mode "Full (strict)". See `infra/cloudflare/README.md`.

**User gates for A→B:** Cloudflare account + API token; DNS for the api/app
hostnames; managed Postgres/Redis (or accept self-hosted); Clerk keys.

---

## Stage B → C hardening

Applied incrementally — each item is independently reversible and none is
required for the app to run.

1. **WAF + rate limits + CSP** (`infra/cloudflare/`, templates — user runs
   `terraform plan`/`apply`):
   - Managed WAF (Cloudflare Managed + OWASP: XSS/SQLi/RCE), bot
     managed-challenge, L7 DDoS override — `waf.tf`.
   - Per-route edge rate limits mirroring the gateway buckets — `rate_limits.tf`.
   - Enforced production CSP + security headers — `pages.tf` (edge transform) or
     `_headers.template` (copied to `apps/web/public/_headers` by the web owner).
     Use one path, not both.

2. **Internal mTLS** on all internal gRPC (`infra/tls/`):
   - `./infra/tls/gen-certs.sh` → CA + per-service leaves.
   - Ship the per-service code change in `infra/tls/WIRING.md` (a follow-up for
     service owners), mount the leaves, then flip `VERITY_MTLS=1`. Keep it `0`
     until **all four** services are wired — a half-wired mesh fails closed.

3. **Pen-test corpus + cross-tenant tests** (already in `infra/ci/`:
   `cross_tenant_test.sh`, `cross_tenant_http.sh`) run green before the M6 gate.

**User gates for B→C:** Cloudflare plan tier that includes managed rulesets /
Bot Management (or accept the portable custom-rule stand-ins); a `terraform
apply`; the mTLS follow-up merged; security-audit sign-off (the M6 gate is the
**v1 retirement gate**).

---

## Readiness — `/healthz`

Every service answers `GET /healthz` and never 500s just because config is
missing; it returns `status: "ok"` or `"degraded"` with a `missing_config`
list. Ports (all bound to `0.0.0.0` in prod via compose env):

| Service | HTTP /healthz | gRPC | Notes |
|---|---|---|---|
| gateway | 8080 (published) | — | dials brain:9100, core:9200 |
| brain | 8000 | 9100 | `db` flag reports pool availability |
| core | 8200 | 9200 | |
| node | 8300 | — (client only) | `registered` flag; off by default |

Readiness gate for a deploy = every started service's `/healthz` reachable and
reporting `ok` for the config you actually supplied (a `degraded` for an
intentionally-unset optional is expected, not a failure).

---

## Migrations — applied by named command only

Schema changes are numbered SQL files in `infra/migrations/`
(`0001_schema_v1.sql`, `0002_compute_network.sql`, `0003_platform_wiring.sql`),
append-only, PR-reviewed. They are **never** applied automatically at boot and
**never** by an agent without explicit, named user approval for a production
database (v1 lesson, now law).

Apply, in order, against the target DB — a documented, named invocation:

```bash
# Review the diff in the PR first. Then, with the operator's named approval:
for f in infra/migrations/[0-9]*.sql; do
  echo ">> applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

Track applied files out-of-band (a `schema_migrations` ledger or the reviewed
PR list). For managed Postgres (Supabase), run the same files via the SQL editor
or `supabase db push` — same review-then-named-apply discipline.

---

## Rollback

Config-only and reversible at every layer:

- **Service version:** images are tagged (`VERITY_TAG`). Roll back by setting
  `VERITY_TAG` to the previous tag and `docker compose ... up -d` (recreates the
  changed services only). Because boot degrades, a rolled-back service that
  reconnects to unchanged peers comes up clean.
- **Cloudflare:** `terraform apply` a reverted config, or disable a specific
  ruleset rule (`enabled = false`) and re-apply. Rate-limit/WAF changes take
  effect at the edge within seconds and touch no service.
- **mTLS:** set `VERITY_MTLS=0` and restart — the mesh returns to plaintext
  immediately (the code path degrades by design). CA/leaf rotation rollback:
  keep the previous `ca.crt` in the trust bundle until the new one is proven
  (see `infra/tls/README.md`).
- **Migrations:** forward-only by policy. To reverse, write a new numbered
  migration that undoes the change (reviewed + named-approved like any other) —
  never edit or delete an applied file.
- **Frontend:** Pages keeps prior deployments; promote a previous deployment to
  production in the dashboard or via wrangler.

Nothing in this runbook deletes data or is one-way; the only irreversible-by-
policy surface is applied migrations, which is why they are forward-only and
gated.
