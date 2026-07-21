# Per-route rate limits (plan §2 L2) — EDGE layer, per client IP.
#
# These MIRROR the gateway's authoritative per-user token buckets
# (services/gateway/ratelimit.go). The gateway remains the source of truth:
# it keys on authenticated user-id in Redis and enforces the burst. Cloudflare
# adds a coarse per-IP ceiling in front (defense in depth, and the only limit
# that applies to the unauthenticated public transcript route). Numbers below
# are the gateway's requests-per-MINUTE, expressed as N requests / 60s period.
#
#   route class   gateway (perMin/burst)   edge cap (per IP / 60s)
#   api           300 / 60                 300
#   chat          60  / 10                 60
#   flow          20  / 5                  20
#   office        20  / 5                  20
#   mcp           30  / 10                 30
#   upload        20  / 5                  20
#   compute       30  / 10                 30
#   transcript*   60  / 20  (public)       60
#
# Rules run in order: specific routes first so the tighter per-route ceiling
# mitigates before the broad /v1/* api ceiling.
resource "cloudflare_ruleset" "rate_limits" {
  zone_id     = var.zone_id
  name        = "verity-rate-limits"
  description = "Per-route edge rate limits mirroring the gateway token buckets"
  kind        = "zone"
  phase       = "http_ratelimit"

  # chat: /v1/chat and /v1/messages/* (regenerate, edit) — 60/min
  rules {
    action      = "block"
    description = "chat 60/min per IP"
    expression  = "(http.host eq \"${var.api_hostname}\") and (starts_with(http.request.uri.path, \"/v1/chat\") or starts_with(http.request.uri.path, \"/v1/messages\"))"
    ratelimit {
      characteristics     = ["ip.src"]
      period              = 60
      requests_per_period = 60
      mitigation_timeout  = 60
    }
  }

  # flow: /v1/flows — 20/min
  rules {
    action      = "block"
    description = "flow 20/min per IP"
    expression  = "(http.host eq \"${var.api_hostname}\") and starts_with(http.request.uri.path, \"/v1/flows\")"
    ratelimit {
      characteristics     = ["ip.src"]
      period              = 60
      requests_per_period = 20
      mitigation_timeout  = 60
    }
  }

  # office: /v1/offices/*/run — 20/min
  rules {
    action      = "block"
    description = "office 20/min per IP"
    expression  = "(http.host eq \"${var.api_hostname}\") and (starts_with(http.request.uri.path, \"/v1/offices\") and ends_with(http.request.uri.path, \"/run\"))"
    ratelimit {
      characteristics     = ["ip.src"]
      period              = 60
      requests_per_period = 20
      mitigation_timeout  = 60
    }
  }

  # mcp: /v1/mcp/call — 30/min
  rules {
    action      = "block"
    description = "mcp 30/min per IP"
    expression  = "(http.host eq \"${var.api_hostname}\") and starts_with(http.request.uri.path, \"/v1/mcp/call\")"
    ratelimit {
      characteristics     = ["ip.src"]
      period              = 60
      requests_per_period = 30
      mitigation_timeout  = 60
    }
  }

  # upload: /v1/upload — 20/min
  rules {
    action      = "block"
    description = "upload 20/min per IP"
    expression  = "(http.host eq \"${var.api_hostname}\") and starts_with(http.request.uri.path, \"/v1/upload\")"
    ratelimit {
      characteristics     = ["ip.src"]
      period              = 60
      requests_per_period = 20
      mitigation_timeout  = 60
    }
  }

  # compute: /v1/compute/jobs — 30/min
  rules {
    action      = "block"
    description = "compute 30/min per IP"
    expression  = "(http.host eq \"${var.api_hostname}\") and starts_with(http.request.uri.path, \"/v1/compute/jobs\")"
    ratelimit {
      characteristics     = ["ip.src"]
      period              = 60
      requests_per_period = 30
      mitigation_timeout  = 60
    }
  }

  # transcript (PUBLIC, unauthenticated): /v1/transcripts/* — 60/min per IP.
  # This is the only rule protecting a route with no user-id to key on.
  rules {
    action      = "block"
    description = "transcript 60/min per IP (public)"
    expression  = "(http.host eq \"${var.api_hostname}\") and starts_with(http.request.uri.path, \"/v1/transcripts\")"
    ratelimit {
      characteristics     = ["ip.src"]
      period              = 60
      requests_per_period = 60
      mitigation_timeout  = 60
    }
  }

  # api catch-all: everything else under /v1/* — 300/min. Placed LAST.
  rules {
    action      = "block"
    description = "api 300/min per IP (catch-all)"
    expression  = "(http.host eq \"${var.api_hostname}\") and starts_with(http.request.uri.path, \"/v1/\")"
    ratelimit {
      characteristics     = ["ip.src"]
      period              = 60
      requests_per_period = 300
      mitigation_timeout  = 60
    }
  }
}
