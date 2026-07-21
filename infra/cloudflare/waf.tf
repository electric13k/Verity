# WAF + bot + L7 DDoS (plan §2 L1/edge). Three rulesets on the zone's
# request-firewall phases. Managed rules (XSS/SQLi) require a Cloudflare plan
# tier that includes the Managed/OWASP rulesets; the custom rules below work on
# any tier and are the portable baseline.

# ---- Managed rulesets: Cloudflare Managed + OWASP (XSS, SQLi, RCE, etc.) ----
# phase = http_request_firewall_managed. Deploys Cloudflare's curated managed
# rulesets by their well-known IDs. Bot protection at the managed layer is
# Super Bot Fight Mode / Bot Management (config below) — this phase covers the
# signature WAF.
resource "cloudflare_ruleset" "managed_waf" {
  zone_id     = var.zone_id
  name        = "verity-managed-waf"
  description = "Cloudflare Managed Ruleset + OWASP Core (XSS/SQLi/RCE)"
  kind        = "zone"
  phase       = "http_request_firewall_managed"

  # Cloudflare Managed Ruleset.
  rules {
    action = "execute"
    action_parameters {
      id = "efb7b8c949ac4650a09736fc376e9aee"
    }
    expression  = "true"
    description = "Execute Cloudflare Managed Ruleset"
    enabled     = true
  }

  # OWASP Core Ruleset (anomaly scoring: XSS/SQLi/LFI/RCE families).
  rules {
    action = "execute"
    action_parameters {
      id = "4814384a9e5d4991b9815dcfc25d2f1f"
    }
    expression  = "true"
    description = "Execute OWASP Core Ruleset"
    enabled     = true
  }
}

# ---- Custom firewall: portable baseline (bot + method + body caps) ----------
# phase = http_request_firewall_custom. Runs before the managed phase.
resource "cloudflare_ruleset" "custom_firewall" {
  zone_id     = var.zone_id
  name        = "verity-custom-firewall"
  description = "Bot mitigation, method allow-list, oversized-body block for the API"
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  # Managed-challenge likely-automated traffic to the API. cf.bot_management.score
  # is populated on Bot Management tiers; the threat_score fallback works broadly.
  rules {
    action      = "managed_challenge"
    expression  = "(http.host eq \"${var.api_hostname}\") and (cf.threat_score gt 20)"
    description = "Challenge suspicious/bot traffic hitting the API"
    enabled     = true
  }

  # Only allow the verbs the gateway serves; drop the rest at the edge.
  rules {
    action      = "block"
    expression  = "(http.host eq \"${var.api_hostname}\") and not (http.request.method in {\"GET\" \"POST\" \"PATCH\" \"OPTIONS\"})"
    description = "Block unexpected HTTP methods on the API"
    enabled     = true
  }

  # Body-size cap at the edge (defense in depth; the gateway also caps bodies).
  # 10 MiB accommodates the upload route; tighten per-route if desired.
  rules {
    action      = "block"
    expression  = "(http.host eq \"${var.api_hostname}\") and (http.request.body.size gt 10485760)"
    description = "Block oversized request bodies (>10 MiB)"
    enabled     = true
  }
}

# ---- L7 DDoS override -------------------------------------------------------
# phase = ddos_l7. Cloudflare's HTTP DDoS managed ruleset is on by default;
# this override raises its sensitivity for the zone. (Sensitivity/action fields
# vary by plan; adjust after `terraform plan` shows the accepted schema.)
resource "cloudflare_ruleset" "l7_ddos" {
  zone_id     = var.zone_id
  name        = "verity-l7-ddos"
  description = "HTTP DDoS managed ruleset override (higher sensitivity)"
  kind        = "zone"
  phase       = "ddos_l7"

  rules {
    action = "execute"
    action_parameters {
      id = "4d21379b4f9f4bb088e0729962c8b3cf" # Cloudflare HTTP DDoS managed ruleset
      overrides {
        sensitivity_level = "high"
      }
    }
    expression  = "true"
    description = "Raise HTTP DDoS sensitivity"
    enabled     = true
  }
}

# ---- Bot management (tier-dependent) ----------------------------------------
# Enterprise Bot Management: uncomment and set. On Free/Pro/Business, enable
# Super Bot Fight Mode in the dashboard (Security > Bots) — it has no stable
# Terraform resource on those tiers; the custom managed_challenge rule above is
# the portable stand-in.
#
# resource "cloudflare_bot_management" "verity" {
#   zone_id                = var.zone_id
#   enable_js              = true
#   suppress_session_score = false
#   fight_mode             = true
# }
