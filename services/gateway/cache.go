// Response caching (SCALE_BACKLOG: caching). A small response cache for
// cacheable, idempotent GETs — e.g. the public transcript read, which is the
// same bytes for every viewer of a share id. Redis-backed when REDIS_URL is
// set; otherwise an in-memory store so the capability degrades, never dies.
//
// Tenant safety is structural, not incidental:
//   - Every key is prefixed by an explicit SCOPE. scopePublic keys are shared
//     (unauthenticated, capability-in-URL reads). scopeTenant keys embed the
//     verified user id, so one tenant can NEVER read another tenant's cached
//     response. A tenant-scoped request with no user id is simply not cached.
//   - Only successful (200) GET responses without a no-store directive are
//     stored. Authed mutable data is never wrapped by this middleware.
package main

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/redis/go-redis/v9"
)

type cacheScope string

const (
	scopePublic cacheScope = "pub"
	scopeTenant cacheScope = "u"
)

const cacheKeyPrefix = "verity:respcache:"

// cacheEntry is the stored response snapshot.
type cacheEntry struct {
	Status      int    `json:"s"`
	ContentType string `json:"ct"`
	Body        []byte `json:"b"`
}

// cacheStore is the pluggable backend. Both implementations are safe for
// concurrent use.
type cacheStore interface {
	get(ctx context.Context, key string) (*cacheEntry, bool)
	set(ctx context.Context, key string, e *cacheEntry, ttl time.Duration)
	kind() string
}

// --- in-memory backend (always available) ----------------------------------

type memEntry struct {
	e       cacheEntry
	expires time.Time
}

type memoryStore struct {
	mu   sync.Mutex
	data map[string]memEntry
}

func newMemoryStore() *memoryStore {
	s := &memoryStore{data: make(map[string]memEntry)}
	go s.sweepLoop()
	return s
}

func (s *memoryStore) get(_ context.Context, key string) (*cacheEntry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	me, ok := s.data[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(me.expires) {
		delete(s.data, key)
		return nil, false
	}
	cp := me.e
	return &cp, true
}

func (s *memoryStore) set(_ context.Context, key string, e *cacheEntry, ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[key] = memEntry{e: *e, expires: time.Now().Add(ttl)}
}

func (s *memoryStore) kind() string { return "memory" }

func (s *memoryStore) sweepLoop() {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for now := range t.C {
		s.mu.Lock()
		for k, me := range s.data {
			if now.After(me.expires) {
				delete(s.data, k)
			}
		}
		s.mu.Unlock()
	}
}

// --- redis backend ----------------------------------------------------------

type redisStore struct {
	client *redis.Client
}

func (s *redisStore) get(ctx context.Context, key string) (*cacheEntry, bool) {
	raw, err := s.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, false // redis.Nil (miss) or transport error → treat as miss
	}
	var e cacheEntry
	if json.Unmarshal(raw, &e) != nil {
		return nil, false
	}
	return &e, true
}

func (s *redisStore) set(ctx context.Context, key string, e *cacheEntry, ttl time.Duration) {
	raw, err := json.Marshal(e)
	if err != nil {
		return
	}
	// Best-effort: a failed write just means a future miss, never an error to
	// the caller. TTL bounds staleness (Redis expires the key).
	_ = s.client.Set(ctx, key, raw, ttl).Err()
}

func (s *redisStore) kind() string { return "redis" }

// --- cache facade + middleware ---------------------------------------------

type responseCache struct {
	store cacheStore
}

// newResponseCache builds a Redis-backed cache when REDIS_URL is set and the
// client constructs cleanly; otherwise the in-memory store. It never blocks on
// or pings Redis at boot (degrade-never-die) — a dead Redis simply yields
// misses and best-effort writes.
func newResponseCache() *responseCache {
	if url := strings.TrimSpace(os.Getenv("REDIS_URL")); url != "" {
		if opt, err := redis.ParseURL(url); err == nil {
			return &responseCache{store: &redisStore{client: redis.NewClient(opt)}}
		}
	}
	return &responseCache{store: newMemoryStore()}
}

func (rc *responseCache) kind() string { return rc.store.kind() }

// buildKey composes a namespaced, scope-prefixed cache key. For scopeTenant the
// user id is embedded so tenants never collide; identity comes from the
// validated token (currentUserID), never from the request. Returns ok=false for
// a tenant-scoped request with no user id (fail safe: do not cache).
func buildKey(scope cacheScope, userID, target string) (string, bool) {
	switch scope {
	case scopePublic:
		return cacheKeyPrefix + string(scopePublic) + ":" + target, true
	case scopeTenant:
		if userID == "" {
			return "", false
		}
		return cacheKeyPrefix + string(scopeTenant) + ":" + userID + ":" + target, true
	default:
		return "", false
	}
}

// cacheable returns the fiber handler that caches GETs for one route at `scope`.
// Non-GET requests pass straight through. On a hit the stored response is served
// without touching the upstream; on a miss the upstream runs and a 200 response
// (absent a no-store directive) is stored for `ttl`.
func (rc *responseCache) cacheable(scope cacheScope, ttl time.Duration) fiber.Handler {
	return func(c fiber.Ctx) error {
		if c.Method() != fiber.MethodGet {
			return c.Next()
		}
		key, ok := buildKey(scope, currentUserID(c), c.OriginalURL())
		if !ok {
			return c.Next()
		}
		ctx := c.Context()
		if e, hit := rc.store.get(ctx, key); hit {
			c.Set("X-Cache", "HIT")
			if e.ContentType != "" {
				c.Set("Content-Type", e.ContentType)
			}
			return c.Status(e.Status).Send(e.Body)
		}

		c.Set("X-Cache", "MISS")
		if err := c.Next(); err != nil {
			return err
		}

		// Only cache clean, idempotent successes. Honor an explicit no-store.
		if c.Response().StatusCode() != fiber.StatusOK {
			return nil
		}
		if cc := string(c.Response().Header.Peek("Cache-Control")); strings.Contains(cc, "no-store") || strings.Contains(cc, "private") {
			return nil
		}
		body := c.Response().Body()
		stored := make([]byte, len(body))
		copy(stored, body)
		rc.store.set(ctx, key, &cacheEntry{
			Status:      fiber.StatusOK,
			ContentType: string(c.Response().Header.ContentType()),
			Body:        stored,
		}, ttl)
		return nil
	}
}
