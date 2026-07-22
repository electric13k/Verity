// Supabase Auth verification (L2), the named fallback to Clerk (MASTER_PLAN §1).
//
// Verification approach (from the current Supabase docs — Auth › JWTs / Signing
// Keys, https://supabase.com/docs/guides/auth/jwts):
//
//   - Supabase access tokens are JWTs. Preferred signing is ASYMMETRIC
//     (RS256 / ES256 / EdDSA): the project publishes its public keys at
//     <project>/auth/v1/.well-known/jwks.json, and a backend verifies the
//     signature against that JWKS without ever holding the secret.
//   - The LEGACY default is SYMMETRIC HS256 using the project "JWT secret"
//     (a shared secret). We support it via SUPABASE_JWT_SECRET.
//   - Claims: iss = "https://<ref>.supabase.co/auth/v1", aud = "authenticated",
//     sub = the user's uuid, top-level "email" claim, role = "authenticated".
//
// We reuse the existing JWKS verifier machinery (MicahParks/keyfunc) for the
// asymmetric path. iss / aud / exp are validated; anything invalid or expired
// fails closed. `sub` maps to the tenant user id and `email` into tenant_ctx —
// the exact shape brain/core already consume, so they need zero changes.
//
// Every input here is optional: an unconfigured Supabase provider degrades to a
// closed door (503 at the route), never a boot failure. No secret is ever logged.
package main

import (
	"errors"
	"log/slog"
	"os"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// asymmetric algorithms Supabase may use for signing when asymmetric keys are
// enabled. HS256 is added dynamically only when a shared secret is configured,
// so an HS256 token can never be accepted against an asymmetric-only project
// (alg-confusion guard).
var supabaseAsymMethods = []string{"RS256", "ES256", "EdDSA"}

type supabaseVerifier struct {
	keys     keyfunc.Keyfunc // asymmetric JWKS; nil when only HS256 is configured
	hsSecret []byte          // HS256 shared secret; nil when only asymmetric
	issuer   string          // https://<ref>.supabase.co/auth/v1 ("" skips iss check)
	audience string          // expected aud, default "authenticated" ("" skips aud check)
	methods  []string        // permitted signing algorithms (union of what is configured)
}

// supabaseBaseURL resolves the project origin from SUPABASE_URL
// (https://<ref>.supabase.co) or SUPABASE_PROJECT_REF (<ref>). Empty if neither.
func supabaseBaseURL() string {
	if u := strings.TrimSpace(os.Getenv("SUPABASE_URL")); u != "" {
		return strings.TrimRight(u, "/")
	}
	if ref := strings.TrimSpace(os.Getenv("SUPABASE_PROJECT_REF")); ref != "" {
		return "https://" + ref + ".supabase.co"
	}
	return ""
}

// supabaseJWKSURL is the explicit SUPABASE_JWKS_URL or the derived well-known
// path off the project origin. Empty when the project cannot be resolved.
func supabaseJWKSURL() string {
	if j := strings.TrimSpace(os.Getenv("SUPABASE_JWKS_URL")); j != "" {
		return j
	}
	if base := supabaseBaseURL(); base != "" {
		return base + "/auth/v1/.well-known/jwks.json"
	}
	return ""
}

// supabaseIssuer is the explicit SUPABASE_ISSUER or the derived
// "<project>/auth/v1". Empty disables the iss check (logged, degrade-never-die).
func supabaseIssuer() string {
	if iss := strings.TrimSpace(os.Getenv("SUPABASE_ISSUER")); iss != "" {
		return strings.TrimRight(iss, "/")
	}
	if base := supabaseBaseURL(); base != "" {
		return base + "/auth/v1"
	}
	return ""
}

func newSupabaseVerifier() *supabaseVerifier {
	v := &supabaseVerifier{
		issuer:   supabaseIssuer(),
		audience: envOr("SUPABASE_JWT_AUD", "authenticated"),
	}
	// "-" is the explicit opt-out for the aud check (some self-hosted setups
	// mint a different audience); an unset var keeps the safe default.
	if v.audience == "-" {
		v.audience = ""
	}

	if jwksURL := supabaseJWKSURL(); jwksURL != "" {
		if keys, err := keyfunc.NewDefault([]string{jwksURL}); err != nil {
			// Degrade, never die: log and leave asymmetric unconfigured; the
			// HS256 path (if any) still works, else the route fails closed.
			// The error is a JWKS-URL fetch/parse failure — no secret in it.
			slog.Warn("supabase jwks init failed; asymmetric verification unavailable", "err", err)
		} else {
			v.keys = keys
			v.methods = append(v.methods, supabaseAsymMethods...)
		}
	}
	if secret := strings.TrimSpace(os.Getenv("SUPABASE_JWT_SECRET")); secret != "" {
		v.hsSecret = []byte(secret)
		v.methods = append(v.methods, "HS256")
	}
	return v
}

func (v *supabaseVerifier) configured() bool {
	return v != nil && (v.keys != nil || len(v.hsSecret) > 0)
}

var errSupabaseUnverifiable = errors.New("supabase token unverifiable")

// keyFor returns the verification key for a token, selected strictly by the
// token's alg header. HS256 → shared secret; asymmetric → JWKS public key. The
// key material never crosses algorithm families, so an attacker cannot force an
// RSA public key to be used as an HMAC secret (classic alg-confusion attack).
func (v *supabaseVerifier) keyFor(token *jwt.Token) (any, error) {
	alg, _ := token.Header["alg"].(string)
	if alg == "HS256" {
		if len(v.hsSecret) == 0 {
			return nil, errSupabaseUnverifiable
		}
		return v.hsSecret, nil
	}
	if v.keys == nil {
		return nil, errSupabaseUnverifiable
	}
	return v.keys.Keyfunc(token)
}

// verify validates a Supabase JWT and returns (sub, email). It enforces the
// permitted algorithms, requires and validates exp (fail closed on expired),
// and checks iss / aud when configured.
func (v *supabaseVerifier) verify(token string) (sub, email string, err error) {
	if !v.configured() {
		return "", "", errSupabaseUnverifiable
	}
	claims := jwt.MapClaims{}
	opts := []jwt.ParserOption{
		jwt.WithValidMethods(v.methods),
		jwt.WithExpirationRequired(),
	}
	if v.issuer != "" {
		opts = append(opts, jwt.WithIssuer(v.issuer))
	}
	if v.audience != "" {
		opts = append(opts, jwt.WithAudience(v.audience))
	}
	parsed, perr := jwt.ParseWithClaims(token, claims, v.keyFor, opts...)
	if perr != nil || !parsed.Valid {
		return "", "", errors.New("invalid supabase token")
	}
	sub, _ = claims["sub"].(string)
	if sub == "" {
		return "", "", errors.New("supabase token missing sub")
	}
	email, _ = claims["email"].(string)
	return sub, email, nil
}
