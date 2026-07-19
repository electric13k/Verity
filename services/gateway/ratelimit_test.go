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

// M1 regression: idle buckets must be evicted so the map cannot grow without
// bound. Buckets touched within the TTL survive; those past it are swept.
func TestLimiterSweepEvictsIdleBuckets(t *testing.T) {
	l := newLimiter(60, 3)
	now := time.Now()
	for i := 0; i < 50; i++ {
		l.allow(string(rune('a'+i%26))+string(rune('0'+i/26)), now)
	}
	if l.size() != 50 {
		t.Fatalf("want 50 buckets before sweep, got %d", l.size())
	}
	// One bucket stays warm; the rest go idle past the TTL.
	warm := "a0"
	l.allow(warm, now.Add(l.ttl+2*time.Minute))
	evicted := l.sweep(now.Add(l.ttl + 90*time.Second))
	if evicted != 49 {
		t.Fatalf("want 49 idle buckets evicted, got %d", evicted)
	}
	if l.size() != 1 {
		t.Fatalf("want 1 warm bucket left, got %d", l.size())
	}
	// Eviction is behaviour-preserving: a swept-then-recreated bucket still
	// starts at full burst, exactly like the one it replaced.
	fresh := now.Add(l.ttl + 3*time.Minute)
	for i := 0; i < 3; i++ {
		if !l.allow("b0", fresh) {
			t.Fatalf("recreated bucket request %d should pass at full burst", i)
		}
	}
}
