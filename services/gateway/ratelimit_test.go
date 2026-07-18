package main

import (
	"testing"
	"time"
)

func TestLimiterBurstThenRefill(t *testing.T) {
	l := newLimiter(60, 3) // 1 token/sec, burst 3
	now := time.Now()
	for i := 0; i < 3; i++ {
		if !l.allow("user_a", now) {
			t.Fatalf("request %d within burst should pass", i)
		}
	}
	if l.allow("user_a", now) {
		t.Fatal("burst exhausted; request should be limited")
	}
	// Another user has an independent bucket.
	if !l.allow("user_b", now) {
		t.Fatal("user_b must not share user_a's bucket")
	}
	// After 2s, ~2 tokens refilled.
	if !l.allow("user_a", now.Add(2*time.Second)) {
		t.Fatal("tokens should refill over time")
	}
}
