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

type bucket struct {
	tokens float64
	last   time.Time
}

type limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens per second
	burst   float64
}

func newLimiter(ratePerMin float64, burst int) *limiter {
	return &limiter{
		buckets: make(map[string]*bucket),
		rate:    ratePerMin / 60.0,
		burst:   float64(burst),
	}
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
