// Per-user token-bucket rate limits (L2). Each route class (chat, flow,
// office, upload) gets its own bucket per user id.
//
// Stage A runs a single gateway instance, so the buckets live in memory.
// ponytail: Redis-backed buckets at Stage B when the gateway scales
// horizontally (REDIS_URL is already in config for it).
package main

import (
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"
)

// idleBucketTTL: a bucket untouched for this long is evicted (M1). Eviction is
// behaviour-preserving — an idle bucket has fully refilled to `burst`, which is
// identical to the fresh bucket a later request would create — so the sweep can
// never let a limited user slip past. It only bounds memory. The TTL is kept
// comfortably larger than any route's full-refill time (burst/rate seconds).
const idleBucketTTL = 10 * time.Minute

// sweepInterval: how often the background sweeper runs. 0 disables it (used by
// unit tests that drive sweep() directly and want no stray goroutine).
const sweepInterval = time.Minute

type bucket struct {
	tokens float64
	last   time.Time
}

type limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens per second
	burst   float64
	ttl     time.Duration
}

func newLimiter(ratePerMin float64, burst int) *limiter {
	l := &limiter{
		buckets: make(map[string]*bucket),
		rate:    ratePerMin / 60.0,
		burst:   float64(burst),
		ttl:     idleBucketTTL,
	}
	if sweepInterval > 0 {
		go l.sweepLoop(sweepInterval)
	}
	return l
}

func (l *limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// sweep evicts buckets idle for longer than the TTL. Behaviour-preserving:
// an evicted bucket had refilled to full burst, so a subsequent request just
// recreates an identical fresh bucket. Returns the count evicted (for tests).
func (l *limiter) sweep(now time.Time) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	evicted := 0
	for key, b := range l.buckets {
		if now.Sub(b.last) > l.ttl {
			delete(l.buckets, key)
			evicted++
		}
	}
	return evicted
}

func (l *limiter) size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

func (l *limiter) sweepLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for now := range ticker.C {
		l.sweep(now)
	}
}

// rateLimit builds middleware for one route class. Must run after
// requireAuth (keys are user ids).
func rateLimit(class string, perMin float64, burst int) fiber.Handler {
	l := newLimiter(perMin, burst)
	return func(c fiber.Ctx) error {
		if !l.allow(currentUserID(c), time.Now()) {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "rate limit exceeded", "class": class,
			})
		}
		return c.Next()
	}
}

// publicRateLimit builds middleware for an UNAUTHENTICATED route (e.g. the
// public transcript view). There is no user id to key on, so it keys by client
// IP — the only identity available on a public path.
func publicRateLimit(class string, perMin float64, burst int) fiber.Handler {
	l := newLimiter(perMin, burst)
	return func(c fiber.Ctx) error {
		if !l.allow(c.IP(), time.Now()) {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "rate limit exceeded", "class": class,
			})
		}
		return c.Next()
	}
}
