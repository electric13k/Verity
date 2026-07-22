// Session verification (L2). The gateway supports multiple identity providers,
// selected by VERITY_AUTH_PROVIDER (clerk|supabase|dev; default clerk — current
// behavior). Clerk issues RS256 session JWTs verified against the instance
// JWKS; Supabase issues asymmetric (RS256/ES256/EdDSA via project JWKS) or
// legacy HS256 (shared secret) JWTs — see auth_supabase.go. Every provider maps
// its subject into the SAME tenant_ctx (user id + org id + email) that brain and
// core already consume from gRPC metadata, so no downstream change is needed.
//
// Fail closed: if the selected provider is not configured and dev mode is not
// explicitly enabled, every protected route answers 503 — a forgotten config can
// never mean an open gateway.
//
// Dev escape (local only): VERITY_DEV_MODE=1 (or VERITY_AUTH_PROVIDER=dev)
// authenticates every request as VERITY_DEV_USER_ID (default "dev_user"). It is
// loud in the logs and must never be set in a deployed environment.
package main

import (
	"errors"
	"log/slog"
	"net/url"
	"os"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"
)

const (
	localUserID = "verity_user_id"
	localOrgID  = "verity_org_id"
	localEmail  = "verity_email"

	providerClerk    = "clerk"
	providerSupabase = "supabase"
	providerDev      = "dev"
)

type authenticator struct {
	// provider selects the verification strategy: clerk (default), supabase,
	// or dev. Unknown/empty values fall back to clerk (current behavior).
	provider  string
	devMode   bool
	devUserID string
	keys      keyfunc.Keyfunc // nil when Clerk is unconfigured
	// issuer is the expected Clerk instance origin. Empty = issuer check is
	// skipped (logged once at boot). Verified against the token `iss` claim.
	issuer string
	// allowedAZP is the set of authorized parties (Clerk `azp`, the request
	// origin) accepted. Empty = azp check skipped (the claim is optional and
	// only present on some Clerk templates).
	allowedAZP map[string]bool
	// supa is the Supabase verifier, initialized only when provider==supabase.
	// nil for every other provider.
	supa *supabaseVerifier
}

// issuerFromJWKS derives the Clerk instance issuer (scheme://host) from the
// JWKS URL (…/.well-known/jwks.json). Clerk's `iss` is exactly that origin.
func issuerFromJWKS(jwksURL string) string {
	u, err := url.Parse(jwksURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func parseAllowedAZP(raw string) map[string]bool {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	set := map[string]bool{}
	for _, p := range strings.Split(raw, ",") {
		if p = strings.TrimSpace(p); p != "" {
			set[p] = true
		}
	}
	return set
}

func newAuthenticator() *authenticator {
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("VERITY_AUTH_PROVIDER")))
	if provider == "" {
		provider = providerClerk // default keeps current behavior
	}
	a := &authenticator{
		provider:  provider,
		devMode:   os.Getenv("VERITY_DEV_MODE") == "1" || provider == providerDev,
		devUserID: envOr("VERITY_DEV_USER_ID", "dev_user"),
	}
	if a.devMode {
		slog.Warn("dev auth enabled (VERITY_DEV_MODE=1 or VERITY_AUTH_PROVIDER=dev) — all requests authenticate as the dev user; never enable in production",
			"dev_user_id", a.devUserID)
		return a
	}
	if provider == providerSupabase {
		a.supa = newSupabaseVerifier()
		if !a.supa.configured() {
			slog.Warn("VERITY_AUTH_PROVIDER=supabase but no Supabase config found; protected routes will refuse requests until SUPABASE_URL/SUPABASE_JWKS_URL or SUPABASE_JWT_SECRET is set")
		}
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

	// Issuer: prefer an explicit CLERK_ISSUER, else derive from the JWKS host.
	// Degrade, never die: if neither yields an issuer, log once and skip the
	// iss check rather than refuse to boot.
	a.issuer = os.Getenv("CLERK_ISSUER")
	if a.issuer == "" {
		a.issuer = issuerFromJWKS(jwksURL)
	}
	if a.issuer == "" {
		slog.Warn("no issuer configured (set CLERK_ISSUER or a well-formed CLERK_JWKS_URL); skipping iss validation")
	}

	// azp: optional allow-list of authorized parties (request origins).
	a.allowedAZP = parseAllowedAZP(os.Getenv("VERITY_ALLOWED_ORIGINS"))
	if a.allowedAZP == nil {
		slog.Info("VERITY_ALLOWED_ORIGINS unset; skipping azp validation (accepting any authorized party)")
	}
	return a
}

func (a *authenticator) configured() bool {
	return a.devMode || a.keys != nil || (a.supa != nil && a.supa.configured())
}

var errNoToken = errors.New("no session token")

// bearerToken extracts the session token from the Authorization header
// (non-browser clients) or the __session cookie (browsers — Supabase and Clerk
// both keep the token out of JS-readable storage; the cookie is sent on every
// request, including the WebSocket handshake).
func bearerToken(c fiber.Ctx) string {
	if h := c.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	if cookie := c.Cookies("__session"); cookie != "" {
		return cookie
	}
	return ""
}

func (a *authenticator) verify(c fiber.Ctx) (userID, orgID, email string, err error) {
	if a.devMode {
		return a.devUserID, "", "", nil
	}
	token := bearerToken(c)
	if token == "" {
		return "", "", "", errNoToken
	}
	// Supabase provider: delegate to the Supabase verifier (auth_supabase.go),
	// which maps `sub`→user id (Supabase has no org concept, so org is empty)
	// and surfaces the `email` claim into tenant_ctx.
	if a.provider == providerSupabase {
		if a.supa == nil {
			return "", "", "", errors.New("supabase auth not configured")
		}
		sub, mail, verr := a.supa.verify(token)
		if verr != nil {
			return "", "", "", verr
		}
		return sub, "", mail, nil
	}
	claims := jwt.MapClaims{}
	opts := []jwt.ParserOption{jwt.WithValidMethods([]string{"RS256"})}
	// When an issuer is configured, jwt/v5 enforces exact iss match (and
	// requires the claim present). Unset issuer degrades to no iss check.
	if a.issuer != "" {
		opts = append(opts, jwt.WithIssuer(a.issuer))
	}
	parsed, err := jwt.ParseWithClaims(token, claims, a.keys.Keyfunc, opts...)
	if err != nil || !parsed.Valid {
		return "", "", "", errors.New("invalid session token")
	}
	// azp (authorized party) — defense in depth against tokens minted for a
	// different frontend on the same Clerk instance. Only enforced when an
	// allow-list is configured.
	if a.allowedAZP != nil {
		azp, _ := claims["azp"].(string)
		if !a.allowedAZP[azp] {
			return "", "", "", errors.New("session token azp not allowed")
		}
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return "", "", "", errors.New("session token missing sub")
	}
	org, _ := claims["org_id"].(string)
	mail, _ := claims["email"].(string)
	return sub, org, mail, nil
}

// requireAuth protects a route group. Expired/tampered/absent sessions are
// dropped here — nothing unauthenticated reaches brain or core.
func (a *authenticator) requireAuth() fiber.Handler {
	return func(c fiber.Ctx) error {
		if !a.configured() {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"error": "auth not configured (set CLERK_JWKS_URL or Supabase config; VERITY_DEV_MODE=1 for local dev)",
			})
		}
		userID, orgID, email, err := a.verify(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}
		c.Locals(localUserID, userID)
		c.Locals(localOrgID, orgID)
		c.Locals(localEmail, email)
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

// currentEmail returns the verified email claim (Supabase always; Clerk when
// the token carries one), empty when absent. Part of tenant_ctx, never trusted
// from a request body.
func currentEmail(c fiber.Ctx) string {
	if v, ok := c.Locals(localEmail).(string); ok {
		return v
	}
	return ""
}
