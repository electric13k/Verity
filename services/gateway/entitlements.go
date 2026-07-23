// Server-authoritative entitlement enforcement (L2, additive to rate limits).
//
// Rate limits are BURST control (token buckets, §ratelimit.go); entitlements are
// PLAN/QUOTA control. Both run — a request must pass the burst bucket AND have
// quota remaining. This middleware is the fail-closed gate that runs BEFORE a
// metered request is proxied to the brain/AI: it calls the brain's
// CheckEntitlement, which decides against the DB keyed to the JWT-verified
// user_id and atomically reserves against the usage ledger.
//
// Why a tampered client buys nothing: the plan and the usage are NEVER read from
// the request body or from any header the client controls. Identity is the
// gateway-verified session (currentUserID), passed downstream only as gRPC
// metadata (outgoingCtx). The only client-influenced input here is an optional
// Idempotency-Key, and it is used solely to dedupe retries — the gateway scopes
// it with the verified user id and the metric so it can neither collide across
// users nor let one client spend as another. Editing the browser bundle to claim
// a plan, a quota, or a usage count changes nothing: every gated action is
// re-decided here, server-side.
package main

import (
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"

	verityv1 "github.com/electric13k/verity/packages/proto/gen/go/verity/v1"
)

// idempotencyKey builds the reservation key for this metered attempt. A
// client-supplied Idempotency-Key (bounded) makes a retry of the SAME logical
// action a no-op charge; absent one, the per-request id makes each attempt a
// distinct charge. Always scoped with the verified user id + metric so the key
// space cannot collide across users or metrics — the client never controls whose
// quota is spent.
func idempotencyKey(c fiber.Ctx, metric string) string {
	token := c.Get("Idempotency-Key")
	if len(token) > 200 {
		token = token[:200]
	}
	if token == "" {
		token = requestid.FromContext(c)
	}
	// currentUserID is the verified session subject, never a body/header value.
	return currentUserID(c) + ":" + metric + ":" + token
}

// entitlement returns middleware that reserves one unit of `metric` for the
// verified user before the handler runs. Denied → 402 Payment Required with a
// clear body. A check that cannot be completed (brain/store unreachable) fails
// CLOSED: the gated action is refused, never let through un-metered.
//
// Ordering (Fiber v3): SSE handlers return via SendStreamWriter without calling
// c.Next(), so anything registered AFTER them never runs — this MUST be
// registered before the handler (order: [rateLimit, entitlement, handler]).
func (s *spine) entitlement(metric string) fiber.Handler {
	return func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 8*time.Second)
		defer cancel()
		resp, err := s.platform.CheckEntitlement(ctx, &verityv1.CheckEntitlementRequest{
			Metric:         metric,
			Amount:         1,
			IdempotencyKey: idempotencyKey(c, metric),
		})
		if err != nil {
			// Fail closed: a required check we could not complete denies the
			// action. Map the upstream code (Unavailable → 503) so retries and
			// dashboards see the truth, but never proxy the request.
			return c.Status(grpcHTTPStatus(err)).JSON(fiber.Map{
				"error":  "entitlement check unavailable",
				"metric": metric,
			})
		}
		if !resp.Allowed {
			// Over quota (or suspended). 402 Payment Required is the quota signal;
			// the body carries plan/limit/remaining for the client to DISPLAY.
			body := fiber.Map{
				"error":     "quota exceeded",
				"metric":    metric,
				"reason":    resp.Reason,
				"plan":      resp.PlanId,
				"limit":     resp.Limit,
				"remaining": resp.Remaining,
			}
			if resp.RetryAfterSeconds > 0 {
				c.Set("Retry-After", itoa(resp.RetryAfterSeconds))
				body["retry_after_seconds"] = resp.RetryAfterSeconds
			}
			return c.Status(fiber.StatusPaymentRequired).JSON(body)
		}
		return c.Next()
	}
}

// itoa is a tiny uint32→decimal-string helper (avoids importing strconv just for
// the Retry-After header).
func itoa(v uint32) string {
	if v == 0 {
		return "0"
	}
	var buf [10]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[i:])
}

// registerEntitlements mounts the read-only plan+usage view. Display-only: the
// client reads its own plan/usage here to render meters — enforcement never
// trusts this response. Keyed to the verified user via gRPC metadata.
func (s *spine) registerEntitlements(v1 fiber.Router) {
	v1.Get("/entitlements", func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		resp, err := s.platform.GetEntitlements(ctx, &verityv1.Empty{})
		if err != nil {
			return upstreamErr(c, err)
		}
		metrics := make([]fiber.Map, 0, len(resp.Metrics))
		for _, m := range resp.Metrics {
			metrics = append(metrics, fiber.Map{
				"metric":    m.Metric,
				"limit":     m.Limit,
				"used":      m.Used,
				"remaining": m.Remaining,
				"window":    m.Window,
			})
		}
		return c.JSON(fiber.Map{
			"plan_id":   resp.PlanId,
			"plan_name": resp.PlanName,
			"status":    resp.Status,
			"enforced":  resp.Enforced,
			"metrics":   metrics,
		})
	})
}
