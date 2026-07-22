package main

import (
	"crypto/rand"
	"crypto/rsa"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"
)

const supaIssuer = "https://abcdefgh.supabase.co/auth/v1"

// newSupaRSAVerifier builds an asymmetric Supabase verifier backed by a fresh
// RSA key, reusing rsaKeys (auth_m2_test.go) as the JWKS.
func newSupaRSAVerifier(t *testing.T) (*supabaseVerifier, *rsa.PrivateKey) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	v := &supabaseVerifier{
		keys:     rsaKeys{pub: &priv.PublicKey},
		issuer:   supaIssuer,
		audience: "authenticated",
		methods:  append([]string{}, supabaseAsymMethods...),
	}
	return v, priv
}

func supaClaims(sub, email string, exp time.Time) jwt.MapClaims {
	return jwt.MapClaims{
		"iss":   supaIssuer,
		"aud":   "authenticated",
		"sub":   sub,
		"email": email,
		"role":  "authenticated",
		"exp":   exp.Unix(),
		"iat":   time.Now().Add(-time.Minute).Unix(),
	}
}

// A valid Supabase RS256 token maps sub→user id and surfaces email.
func TestSupabaseValidTokenAccepted(t *testing.T) {
	v, priv := newSupaRSAVerifier(t)
	tok := signToken(t, priv, supaClaims("11111111-1111-1111-1111-111111111111", "u@example.com", time.Now().Add(time.Hour)))
	sub, email, err := v.verify(tok)
	if err != nil {
		t.Fatalf("valid token rejected: %v", err)
	}
	if sub != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("sub not mapped: %q", sub)
	}
	if email != "u@example.com" {
		t.Fatalf("email not surfaced: %q", email)
	}
}

// Expired tokens fail closed.
func TestSupabaseExpiredRejected(t *testing.T) {
	v, priv := newSupaRSAVerifier(t)
	tok := signToken(t, priv, supaClaims("u1", "u@example.com", time.Now().Add(-time.Hour)))
	if _, _, err := v.verify(tok); err == nil {
		t.Fatal("expired token must be rejected")
	}
}

// A tampered signature fails closed.
func TestSupabaseTamperedRejected(t *testing.T) {
	v, priv := newSupaRSAVerifier(t)
	tok := signToken(t, priv, supaClaims("u1", "u@example.com", time.Now().Add(time.Hour)))
	tampered := tok[:len(tok)-2] + func() string { // flip last chars
		if tok[len(tok)-1] == 'A' {
			return "BB"
		}
		return "AA"
	}()
	if _, _, err := v.verify(tampered); err == nil {
		t.Fatal("tampered token must be rejected")
	}
}

// Wrong issuer / wrong audience fail closed.
func TestSupabaseIssuerAndAudienceChecked(t *testing.T) {
	v, priv := newSupaRSAVerifier(t)

	wrongIss := signToken(t, priv, jwt.MapClaims{
		"iss": "https://evil.supabase.co/auth/v1", "aud": "authenticated",
		"sub": "u1", "exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, _, err := v.verify(wrongIss); err == nil {
		t.Fatal("wrong issuer must be rejected")
	}

	wrongAud := signToken(t, priv, jwt.MapClaims{
		"iss": supaIssuer, "aud": "anon",
		"sub": "u1", "exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, _, err := v.verify(wrongAud); err == nil {
		t.Fatal("wrong audience must be rejected")
	}
}

// Legacy HS256 shared-secret mode: correct secret accepted, wrong secret rejected.
func TestSupabaseHS256Mode(t *testing.T) {
	secret := "super-secret-jwt-key"
	v := &supabaseVerifier{
		hsSecret: []byte(secret),
		issuer:   supaIssuer,
		audience: "authenticated",
		methods:  []string{"HS256"},
	}
	claims := supaClaims("u-hs", "hs@example.com", time.Now().Add(time.Hour))
	good, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	sub, email, err := v.verify(good)
	if err != nil || sub != "u-hs" || email != "hs@example.com" {
		t.Fatalf("HS256 valid token: sub=%q email=%q err=%v", sub, email, err)
	}
	bad, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("wrong-secret"))
	if _, _, err := v.verify(bad); err == nil {
		t.Fatal("HS256 token signed with the wrong secret must be rejected")
	}
}

// Alg-confusion guard: an asymmetric-only verifier must reject an HS256 token
// (no HS256 in permitted methods, and keyFor never yields a secret).
func TestSupabaseAlgConfusionRejected(t *testing.T) {
	v, _ := newSupaRSAVerifier(t) // asymmetric only; hsSecret nil
	forged, _ := jwt.NewWithClaims(jwt.SigningMethodHS256,
		supaClaims("u1", "e@x.com", time.Now().Add(time.Hour))).SignedString([]byte("anything"))
	if _, _, err := v.verify(forged); err == nil {
		t.Fatal("HS256 token against asymmetric-only verifier must be rejected")
	}
}

// Unconfigured verifier reports not-configured and refuses every token.
func TestSupabaseUnconfiguredDegrades(t *testing.T) {
	v := &supabaseVerifier{issuer: supaIssuer, audience: "authenticated"}
	if v.configured() {
		t.Fatal("verifier with no keys/secret must report unconfigured")
	}
	if _, _, err := v.verify("anything"); err == nil {
		t.Fatal("unconfigured verifier must reject")
	}
}

// Provider selection end-to-end: an authenticator wired to the supabase provider
// verifies a Supabase token through requireAuth and injects tenant_ctx.
func TestSupabaseProviderThroughRequireAuth(t *testing.T) {
	v, priv := newSupaRSAVerifier(t)
	a := &authenticator{provider: providerSupabase, supa: v}

	app := fiber.New()
	v1 := app.Group("/v1", a.requireAuth())
	v1.Get("/whoami", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"user_id": currentUserID(c), "email": currentEmail(c)})
	})

	tok := signToken(t, priv, supaClaims("sub-uuid-42", "who@example.com", time.Now().Add(time.Hour)))
	req := httptest.NewRequest("GET", "/v1/whoami", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("valid supabase token via provider: want 200, got %d", resp.StatusCode)
	}

	// An unconfigured supabase provider must fail closed (503).
	closed := &authenticator{provider: providerSupabase, supa: &supabaseVerifier{}}
	appC := fiber.New()
	appC.Group("/v1", closed.requireAuth()).Get("/whoami", func(c fiber.Ctx) error { return c.SendStatus(200) })
	rc, _ := appC.Test(httptest.NewRequest("GET", "/v1/whoami", nil))
	if rc.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("unconfigured supabase provider: want 503, got %d", rc.StatusCode)
	}
}
