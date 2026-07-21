# Verity v2 — Cloudflare edge (WAF, rate limits, Pages) as declarative config.
#
# TEMPLATES ONLY. Nothing here is applied by an agent: it needs the user's
# Cloudflare account, a scoped API token, and a `terraform apply` the user runs
# themselves (plan §7 user gate; Stage C hardening). `terraform validate` is
# safe to run without credentials; `plan`/`apply` are user-gated.
#
# Pin the provider before applying — Cloudflare's ruleset schema evolves across
# provider majors (v4 shown here). Bump deliberately, then re-run `plan`.
terraform {
  required_version = ">= 1.6"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.40"
    }
  }
}

# API token supplied via env: export CLOUDFLARE_API_TOKEN=...  (never in a file).
# Scope it to: Zone.WAF, Zone.Rate Limiting, Zone.Rulesets, Account.Pages — edit.
provider "cloudflare" {}
