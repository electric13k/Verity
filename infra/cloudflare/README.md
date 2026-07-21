# Cloudflare edge — Verity v2 (Stage C hardening)

Declarative config for the edge layer in front of the public gateway and the
Pages-hosted frontend. **Templates only** — applying anything here needs the
user's Cloudflare account and a scoped API token (plan §7 user gate). Agents do
not apply these.

## What's here

| File | Purpose |
|---|---|
| `versions.tf` | Terraform + `cloudflare` provider pin (v4). |
| `variables.tf` | Zone/account IDs, hostnames, Pages inputs (no secrets). |
| `waf.tf` | Managed WAF (Cloudflare Managed + OWASP: XSS/SQLi/RCE), custom firewall (bot managed-challenge, method allow-list, body cap), L7 DDoS override, bot-management stub. |
| `rate_limits.tf` | Per-route edge rate limits mirroring the gateway token buckets. |
| `pages.tf` | Pages project for `apps/web` (`npm run build` → `out`) + edge-enforced CSP/security headers. |
| `_headers.template` | Alternative CSP delivery: a Pages `_headers` file for `apps/web/public/`. Use this OR the transform in `pages.tf`, not both. |
| `terraform.tfvars.example` | Placeholder inputs. |

## Layering (defense in depth)

```
Cloudflare edge                         Origin gateway (Go)
─────────────────────────────────────   ───────────────────────────
WAF managed rules (XSS/SQLi/RCE)         go-playground/validator structs
bot managed-challenge                    JWT verify (Clerk), tenant_ctx
per-IP rate limits (this dir)   ───────▶ per-USER token buckets (Redis)
CSP + security headers                   body caps, request-id
TLS termination (Origin CA / Tunnel)     plaintext :8080 on private side
```

The gateway stays the authoritative per-user limiter (it can see the
authenticated user-id; the edge only sees IPs). The edge caps are a coarse
front-line and the sole limiter on the unauthenticated public transcript route.

## Rate-limit map (mirrors `services/gateway/ratelimit.go`)

| Route class | Paths | Gateway perMin/burst | Edge cap /60s |
|---|---|---|---|
| api | `/v1/*` (catch-all) | 300 / 60 | 300 |
| chat | `/v1/chat`, `/v1/messages/*` | 60 / 10 | 60 |
| flow | `/v1/flows` | 20 / 5 | 20 |
| office | `/v1/offices/*/run` | 20 / 5 | 20 |
| mcp | `/v1/mcp/call` | 30 / 10 | 30 |
| upload | `/v1/upload` | 20 / 5 | 20 |
| compute | `/v1/compute/jobs` | 30 / 10 | 30 |
| transcript (public) | `/v1/transcripts/*` | 60 / 20 | 60 |

## TLS to the origin

The Go gateway listens plaintext on `:8080` (TLS is not in service source). Two
supported fronting patterns, both keeping the origin off the public internet:

1. **Cloudflare Tunnel** (recommended): run `cloudflared` beside the gateway,
   bind the gateway to `127.0.0.1:8080` (`GATEWAY_BIND=127.0.0.1`), no host
   port exposed. The tunnel provides TLS + DDoS + WAF.
2. **Origin CA cert on an LB**: a load balancer terminates a Cloudflare Origin
   CA certificate and forwards to the gateway; set Cloudflare SSL mode to
   "Full (strict)".

Internal service-to-service TLS (gateway↔brain↔core) is separate — see
`infra/tls/` (mTLS, Stage C).

## Apply (user-run)

```bash
cp terraform.tfvars.example terraform.tfvars   # fill IDs + hostnames
export CLOUDFLARE_API_TOKEN=...                 # scoped, user-supplied
terraform init
terraform validate
terraform plan     # review
terraform apply    # user-gated
```

Managed-ruleset IDs and some override fields are plan-tier dependent; if `plan`
rejects a field, adjust per the schema Cloudflare returns for your tier. Bot
Management as a Terraform resource is Enterprise-only; on lower tiers enable
Super Bot Fight Mode in the dashboard (the custom managed-challenge rule in
`waf.tf` is the portable stand-in).
