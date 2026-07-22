// Verity gateway — the only public service. Auth, validation, rate limiting,
// SSE/WS fan-out, and proxying to brain/core over gRPC (M1).
//
// Law: boot degrades, never dies. Missing optional config never prevents
// startup; /healthz reports exactly what is absent.
package main

import (
	"log/slog"
	"os"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"
)

const version = "0.1.0"

// optionalConfig lists env vars the gateway can start without. Anything
// missing is surfaced in /healthz, never fatal. (Service addresses have
// Stage A localhost defaults and are not listed.)
var optionalConfig = []string{
	"REDIS_URL",        // rate-limit buckets, SSE resume (M2)
	"CLERK_SECRET_KEY", // session verification (M2)
}

func missingConfig() []string {
	missing := []string{}
	for _, key := range optionalConfig {
		if os.Getenv(key) == "" {
			missing = append(missing, key)
		}
	}
	return missing
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	if missing := missingConfig(); len(missing) > 0 {
		slog.Warn("starting degraded", "missing_config", missing)
	}

	app := fiber.New(fiber.Config{
		AppName:   "verity-gateway",
		BodyLimit: 4 * 1024 * 1024, // request body cap; raised per-route for uploads later
	})

	// Request-id on every request; the same id propagates to brain/core in
	// gRPC metadata (x-verity-request-id) once the spine lands in M1.
	app.Use(requestid.New())
	// Observability wraps the whole handler stack: per-request structured log
	// (no bodies/secrets) + Prometheus series. Always-on, no config to miss.
	metrics := newMetrics()
	app.Use(metrics.middleware())
	app.Use(securityHeaders())

	// Response cache for cacheable idempotent GETs. Redis-backed when REDIS_URL
	// is set, in-memory otherwise (degrade-never-die).
	respCache := newResponseCache()

	auth := newAuthenticator()

	app.Get("/healthz", func(c fiber.Ctx) error {
		missing := missingConfig()
		status := "ok"
		if len(missing) > 0 {
			status = "degraded"
		}
		return c.JSON(fiber.Map{
			"status":         status,
			"service":        "gateway",
			"version":        version,
			"missing_config": missing,
			// New optional capabilities, reported additively.
			"auth_provider": auth.provider,
			"auth_ready":    auth.configured(),
			"cache_backend": respCache.kind(),
		})
	})

	// Prometheus-style metrics: unauthenticated, aggregate-only, mounted outside
	// the /v1 auth group.
	metrics.registerMetrics(app)

	// Everything under /v1 requires a verified session (fail closed) and is
	// rate limited per user. Route classes get their own buckets.
	v1 := app.Group("/v1", auth.requireAuth(), rateLimit("api", 300, 60))

	sp, err := newSpine()
	if err != nil {
		// Law: degrade, never die — routes answer 503 until brain appears.
		slog.Warn("spine unavailable", "err", err)
	} else {
		sp.registerRoutes(v1)
		sp.registerChat(v1)
		sp.registerFlows(v1)
		sp.registerCompute(v1)
		sp.registerPlatform(v1)
		// WebSocket fan-out: an alternative to the SSE chat/flow streams for
		// clients behind SSE-hostile proxies, with bidirectional control.
		sp.registerWS(v1)
		// Public transcript reads are the same bytes for every viewer of a
		// share id — cache them (public scope, short TTL). Mounted before the
		// route registration below so it fronts the handler.
		app.Use("/v1/transcripts", respCache.cacheable(scopePublic, 30*time.Second))
		// Public, unauthenticated read-only transcript view — mounted on the
		// app, outside the /v1 auth group (the share id is the capability).
		sp.registerTranscripts(app)
	}

	addr := os.Getenv("GATEWAY_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	slog.Info("gateway listening", "addr", addr, "version", version)
	if err := app.Listen(addr); err != nil {
		slog.Error("server exited", "err", err)
		os.Exit(1)
	}
}
