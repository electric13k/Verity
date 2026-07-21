# Cloudflare Pages for the apps/web static export (plan Stage B).
#
# Build: `npm run build` (next build with output:"export") → apps/web/out.
# root_dir points Pages at the app inside the monorepo; destination_dir is the
# export folder. If deploying via CI/direct-upload instead of a connected repo,
# leave github_owner/github_repo blank and push the built `out/` with wrangler.
resource "cloudflare_pages_project" "web" {
  account_id        = var.account_id
  name              = var.pages_project_name
  production_branch = var.production_branch

  build_config {
    build_command   = "npm run build"
    destination_dir = "out"
    root_dir        = "apps/web"
  }

  # Connected-repo source (optional). Omit for direct-upload/CI deploys.
  dynamic "source" {
    for_each = var.github_repo == "" ? [] : [1]
    content {
      type = "github"
      config {
        owner                         = var.github_owner
        repo_name                     = var.github_repo
        production_branch             = var.production_branch
        deployments_enabled           = true
        production_deployment_enabled = true
      }
    }
  }

  deployment_configs {
    production {
      # Frontend points at the gateway origin directly in production (the dev
      # /gw rewrite is stripped from static export — see apps/web/next.config.ts).
      environment_variables = {
        NEXT_PUBLIC_GATEWAY_URL = "https://${var.api_hostname}"
      }
    }
  }
}

# ---- Enforced production CSP + security headers (plan §2 L1) -----------------
# Enforced at the EDGE via a response-header transform so apps/web is not
# touched (its owner may instead ship infra/cloudflare/_headers.template as
# apps/web/public/_headers — either path yields the same header set). The CSP
# is the concrete §2 policy, with the API origin and Clerk allowed for
# connect-src, framing denied, and base-uri locked to self.
locals {
  csp = join(" ", [
    "default-src 'self';",
    "script-src 'self';",
    "style-src 'self' 'unsafe-inline';",
    "connect-src 'self' https://${var.api_hostname} wss://${var.api_hostname} https://*.clerk.accounts.dev;",
    "img-src 'self' data: blob:;",
    "font-src 'self';",
    "frame-ancestors 'none';",
    "base-uri 'self'",
  ])
}

resource "cloudflare_ruleset" "app_security_headers" {
  zone_id     = var.zone_id
  name        = "verity-app-security-headers"
  description = "Production CSP + security headers for the Pages app"
  kind        = "zone"
  phase       = "http_response_headers_transform"

  rules {
    action      = "rewrite"
    expression  = "(http.host eq \"${var.app_hostname}\")"
    description = "Set CSP + hardening headers on the frontend"
    enabled     = true
    action_parameters {
      headers {
        name      = "Content-Security-Policy"
        operation = "set"
        value     = local.csp
      }
      headers {
        name      = "Strict-Transport-Security"
        operation = "set"
        value     = "max-age=63072000; includeSubDomains; preload"
      }
      headers {
        name      = "X-Content-Type-Options"
        operation = "set"
        value     = "nosniff"
      }
      headers {
        name      = "Referrer-Policy"
        operation = "set"
        value     = "strict-origin-when-cross-origin"
      }
      headers {
        name      = "X-Frame-Options"
        operation = "set"
        value     = "DENY"
      }
      headers {
        name      = "Permissions-Policy"
        operation = "set"
        value     = "camera=(), microphone=(), geolocation=(), interest-cohort=()"
      }
      headers {
        name      = "Cross-Origin-Opener-Policy"
        operation = "set"
        value     = "same-origin"
      }
    }
  }
}
