package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MicahParks/jwkset"
	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"
)

func TestIssuerFromJWKS(t *testing.T) {
	cases := map[string]string{
		"https://foo.clerk.accounts.dev/.well-known/jwks.json": "https://foo.clerk.accounts.dev",
		"https://foo.clerk.accounts.dev":                       "https://foo.clerk.accounts.dev",
		"not a url":                                             "",
		"":                                                     "",
	}
	for in, want := range cases {
		if got := issuerFromJWKS(in); got != want {
			t.Errorf("issuerFromJWKS(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseAllowedAZP(t *testing.T) {
	if parseAllowedAZP("") != nil || parseAllowedAZP("   ") != nil {
		t.Fatal("empty/blank should yield nil (check skipped)")
	}
	got := parseAllowedAZP("https://a.app, https://b.app ,")
	if len(got) != 2 || !got["https://a.app"] || !got["https://b.app"] {
		t.Fatalf("unexpected parse: %v", got)
	}
}

// rsaKeys implements keyfunc.Keyfunc backed by a fixed RSA public key so we can
// mint real tokens and exercise iss/azp validation end to end.
type rsaKeys struct{ pub any }

func (k rsaKeys) Keyfunc(*jwt.Token) (any, error) { return k.pub, nil }
func (k rsaKeys) KeyfuncCtx(context.Context) jwt.Keyfunc {
	return func(*jwt.Token) (any, error) { return k.pub, nil }
}
func (rsaKeys) Storage() jwkset.Storage { return nil }

func newRSAAuth(t *testing.T, issuer string, azp map[string]bool) (*authenticator, *rsa.PrivateKey) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return &authenticator{
		keys:       rsaKeys{pub: &priv.PublicKey},
		issuer:     issuer,
		allowedAZP: azp,
	}, priv
}

func signToken(t *testing.T, priv *rsa.PrivateKey, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	s, err := tok.SignedString(priv)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// M2: a token whose iss does not match the configured issuer is rejected.
func TestAuthRejectsWrongIssuer(t *testing.T) {
	a, priv := newRSAAuth(t, "https://real.clerk.accounts.dev", nil)
	app := testApp(a)

	good := signToken(t, priv, jwt.MapClaims{
		"sub": "user_1", "iss": "https://real.clerk.accounts.dev",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	bad := signToken(t, priv, jwt.MapClaims{
		"sub": "user_1", "iss": "https://evil.clerk.accounts.dev",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	for _, tc := range []struct {
		name  string
		token string
		want  int
	}{
		{"matching issuer", good, fiber.StatusOK},
		{"wrong issuer", bad, fiber.StatusUnauthorized},
	} {
		req := httptest.NewRequest("GET", "/v1/whoami", nil)
		req.Header.Set("Authorization", "Bearer "+tc.token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != tc.want {
			t.Errorf("%s: want %d, got %d", tc.name, tc.want, resp.StatusCode)
		}
	}
}

// M2: with an azp allow-list configured, a token whose azp is absent from it is
// rejected; a token with an allowed azp passes.
func TestAuthEnforcesAZPAllowList(t *testing.T) {
	a, priv := newRSAAuth(t, "https://real.clerk.accounts.dev",
		map[string]bool{"https://app.verity.test": true})
	app := testApp(a)

	base := jwt.MapClaims{
		"sub": "user_1", "iss": "https://real.clerk.accounts.dev",
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	allowed := signToken(t, priv, jwt.MapClaims{
		"sub": base["sub"], "iss": base["iss"], "exp": base["exp"],
		"azp": "https://app.verity.test",
	})
	denied := signToken(t, priv, jwt.MapClaims{
		"sub": base["sub"], "iss": base["iss"], "exp": base["exp"],
		"azp": "https://phishing.test",
	})

	for _, tc := range []struct {
		name  string
		token string
		want  int
	}{
		{"allowed azp", allowed, fiber.StatusOK},
		{"denied azp", denied, fiber.StatusUnauthorized},
	} {
		req := httptest.NewRequest("GET", "/v1/whoami", nil)
		req.Header.Set("Authorization", "Bearer "+tc.token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != tc.want {
			t.Errorf("%s: want %d, got %d", tc.name, tc.want, resp.StatusCode)
		}
	}
}

// M2 degrade path: issuer unset ⇒ iss check skipped, token still accepted
// (boot degrades, never dies).
func TestAuthNoIssuerConfiguredSkipsIssCheck(t *testing.T) {
	a, priv := newRSAAuth(t, "", nil)
	app := testApp(a)
	tok := signToken(t, priv, jwt.MapClaims{
		"sub": "user_1", "iss": "https://whatever.clerk.accounts.dev",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	req := httptest.NewRequest("GET", "/v1/whoami", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("unset issuer should accept a valid token; got %d", resp.StatusCode)
	}
}
