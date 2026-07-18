package main

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/MicahParks/jwkset"
	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"
)

func testApp(a *authenticator) *fiber.App {
	app := fiber.New()
	v1 := app.Group("/v1", a.requireAuth())
	v1.Get("/whoami", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"user_id": currentUserID(c)})
	})
	return app
}

// Unconfigured auth must fail closed: 503, never a pass-through.
func TestAuthUnconfiguredFailsClosed(t *testing.T) {
	app := testApp(&authenticator{})
	resp, err := app.Test(httptest.NewRequest("GET", "/v1/whoami", nil))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("want 503, got %d", resp.StatusCode)
	}
}

func TestAuthDevModeIdentifiesUser(t *testing.T) {
	app := testApp(&authenticator{devMode: true, devUserID: "dev_user"})
	resp, err := app.Test(httptest.NewRequest("GET", "/v1/whoami", nil))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
}

// stubKeys satisfies keyfunc.Keyfunc but never validates anything —
// configured auth with absent or garbage tokens must 401.
type stubKeys struct{}

func (stubKeys) Keyfunc(*jwt.Token) (any, error) { return nil, jwt.ErrTokenUnverifiable }
func (stubKeys) KeyfuncCtx(context.Context) jwt.Keyfunc {
	return func(*jwt.Token) (any, error) { return nil, jwt.ErrTokenUnverifiable }
}
func (stubKeys) Storage() jwkset.Storage { return nil }

func TestAuthConfiguredRejectsMissingAndGarbageTokens(t *testing.T) {
	app := testApp(&authenticator{keys: stubKeys{}})

	resp, err := app.Test(httptest.NewRequest("GET", "/v1/whoami", nil))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("missing token: want 401, got %d", resp.StatusCode)
	}

	req := httptest.NewRequest("GET", "/v1/whoami", nil)
	req.Header.Set("Authorization", "Bearer not.a.jwt")
	resp, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("garbage token: want 401, got %d", resp.StatusCode)
	}
}
