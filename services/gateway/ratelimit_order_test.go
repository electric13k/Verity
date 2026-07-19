package main

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"
)

// terminalHandler mimics the SSE/JSON route handlers (chat, flows, compute):
// it writes its response and returns WITHOUT calling c.Next(). Any middleware
// registered after it in the chain therefore never runs.
func terminalHandler(c fiber.Ctx) error {
	return c.SendString("ok")
}

func countStatuses(t *testing.T, app *fiber.App, method, path string, n int) map[int]int {
	t.Helper()
	got := map[int]int{}
	for i := 0; i < n; i++ {
		resp, err := app.Test(httptest.NewRequest(method, path, nil))
		if err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
		got[resp.StatusCode]++
	}
	return got
}

// H1 regression: with the limiter registered BEFORE the terminal handler,
// the tighter bucket must actually trigger — requests beyond the burst get
// 429. Burst is 2, so 5 requests in a tight loop yield at least one 429.
func TestRateLimitBeforeTerminalHandlerTriggers(t *testing.T) {
	app := fiber.New()
	v1 := app.Group("/v1")
	v1.Post("/chat", rateLimit("chat", 60, 2), terminalHandler)

	got := countStatuses(t, app, "POST", "/v1/chat", 5)
	if got[fiber.StatusTooManyRequests] == 0 {
		t.Fatalf("expected the chat bucket to trigger 429s; got %v", got)
	}
	if got[fiber.StatusOK] == 0 {
		t.Fatalf("expected some requests within burst to pass; got %v", got)
	}
}

// H1 regression guard: the OLD (buggy) order — limiter AFTER a terminal
// handler — must be shown to bypass the bucket entirely. This is the exact
// bug the fix corrects; if a future edit reverts the order, this test proves
// the limiter goes dead (every request passes, no 429).
func TestRateLimitAfterTerminalHandlerIsBypassed(t *testing.T) {
	app := fiber.New()
	v1 := app.Group("/v1")
	v1.Post("/chat", terminalHandler, rateLimit("chat", 60, 2))

	got := countStatuses(t, app, "POST", "/v1/chat", 10)
	if got[fiber.StatusTooManyRequests] != 0 {
		t.Fatalf("terminal-handler-first should never reach the limiter; got %v", got)
	}
	if got[fiber.StatusOK] != 10 {
		t.Fatalf("all 10 requests should pass unlimited in the buggy order; got %v", got)
	}
}
