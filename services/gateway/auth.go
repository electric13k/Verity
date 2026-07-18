// Session verification (L2). Clerk issues RS256 session JWTs; we verify
// against the instance JWKS. Fail closed: if auth is not configured and dev
// mode is not explicitly enabled, every protected route answers 503 — a
// forgotten config can never mean an open gateway.
//
// Dev escape (local only): VERITY_DEV_MODE=1 authenticates every request as
// VERITY_DEV_USER_ID (default "dev_user"). It is loud in the logs and must
// never be set in a deployed environment.
package main

import (
	"errors"
	"log/slog"
	"os"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"
)

const (
	localUserID = "verity_user_id"
	localOrgID  = "verity_org_id"
)

type authenticator struct {
	devMode   bool
	devUserID string
	keys      keyfunc.Keyfunc // nil when Clerk is unconfigured
}

func newAuthenticator() *authenticator {
	a := &authenticator{
		devMode:   os.Getenv("VERITY_DEV_MODE") == "1",
		devUserID: envOr("VERITY_DEV_USER_ID", "dev_user"),
	}
	if a.devMode {
		slog.Warn("VERITY_DEV_MODE=1 — all requests authenticate as the dev user; never enable in production",
			"dev_user_id", a.devUserID)
		return a
	}
	jwksURL := os.Getenv("CLERK_JWKS_URL") // e.g. https://<slug>.clerk.accounts.dev/.well-known/jwks.json
	if jwksURL == "" {
		return a // unconfigured → middleware fails closed
	}
	keys, err := keyfunc.NewDefault([]string{jwksURL})
	if err != nil {
		// Degrade, never die: keep serving healthz; protected routes 503.
		slog.Error("jwks init failed; protected routes will refuse requests", "err", err)
		return a
	}
	a.keys = keys
	return a
}

func (a *authenticator) configured() bool { return a.devMode || a.keys != nil }

var errNoToken = errors.New("no session token")

func (a *authenticator) verify(c fiber.Ctx) (userID, orgID string, err error) {
	if a.devMode {
		return a.devUserID, "", nil
	}
	token := ""
	if h := c.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		token = strings.TrimPrefix(h, "Bearer ")
	} else if cookie := c.Cookies("__session"); cookie != "" {
		token = cookie
	}
	if token == "" {
		return "", "", errNoToken
	}
	claims := jwt.MapClaims{}
	parsed, err := jwt.ParseWithClaims(token, claims, a.keys.Keyfunc,
		jwt.WithValidMethods([]string{"RS256"}))
	if err != nil || !parsed.Valid {
		return "", "", errors.New("invalid session token")
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return "", "", errors.New("session token missing sub")
	}
	org, _ := claims["org_id"].(string)
	return sub, org, nil
}

// requireAuth protects a route group. Expired/tampered/absent sessions are
// dropped here — nothing unauthenticated reaches brain or core.
func (a *authenticator) requireAuth() fiber.Handler {
	return func(c fiber.Ctx) error {
		if !a.configured() {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"error": "auth not configured (set CLERK_JWKS_URL; VERITY_DEV_MODE=1 for local dev)",
			})
		}
		userID, orgID, err := a.verify(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}
		c.Locals(localUserID, userID)
		c.Locals(localOrgID, orgID)
		return c.Next()
	}
}

func currentUserID(c fiber.Ctx) string {
	if v, ok := c.Locals(localUserID).(string); ok {
		return v
	}
	return ""
}

func currentOrgID(c fiber.Ctx) string {
	if v, ok := c.Locals(localOrgID).(string); ok {
		return v
	}
	return ""
}
