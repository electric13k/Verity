package main

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
)

type samplePayload struct {
	Message string `json:"message" validate:"required,max=100"`
}

func validateApp() *fiber.App {
	app := fiber.New()
	app.Post("/echo", func(c fiber.Ctx) error {
		p, err := decodeStrict[samplePayload](c)
		if err != nil {
			return badRequest(c, err)
		}
		return c.JSON(p)
	})
	return app
}

func post(t *testing.T, app *fiber.App, body string) int {
	t.Helper()
	req := httptest.NewRequest("POST", "/echo", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode
}

func TestDecodeStrict(t *testing.T) {
	app := validateApp()
	if got := post(t, app, `{"message":"hi"}`); got != 200 {
		t.Fatalf("valid payload: want 200, got %d", got)
	}
	if got := post(t, app, `{"message":"hi","extra":1}`); got != 400 {
		t.Fatalf("unknown field: want 400, got %d", got)
	}
	if got := post(t, app, `{}`); got != 400 {
		t.Fatalf("missing required: want 400, got %d", got)
	}
	if got := post(t, app, `{"message":"hi"} garbage`); got != 400 {
		t.Fatalf("trailing data: want 400, got %d", got)
	}
}
