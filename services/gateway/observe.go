// Observability (L2): a structured access/error-logging middleware and a
// Prometheus-style /metrics endpoint. Both are additive and always-on — there
// is no config to miss, so nothing here can degrade the boot.
//
// Privacy laws honored:
//   - Logs carry request-id, method, ROUTE TEMPLATE (not the raw URL), status,
//     latency and tenant id. Never a body, never a secret, never query values.
//   - /metrics is UNAUTHENTICATED and exposes AGGREGATE series only, keyed by
//     method + route template + status. No tenant id, no path parameter value,
//     nothing per-user ever reaches the exposition. It is safe to scrape openly.
package main

import (
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"
)

// numLatencyBuckets is the count of explicit histogram bounds (excludes +Inf).
const numLatencyBuckets = 11

// latencyBucketsSeconds are the histogram upper bounds (Prometheus convention,
// cumulative). The final +Inf bucket equals the total count.
var latencyBucketsSeconds = [numLatencyBuckets]float64{
	0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
}

// seriesKey identifies one counter series. Low cardinality by construction:
// route is the registered template (e.g. /v1/conversations/:id), never a value.
type seriesKey struct {
	method string
	route  string
	status int
}

type routeHist struct {
	counts [numLatencyBuckets + 1]uint64 // +1 for +Inf
	sum    float64
	count  uint64
}

type metrics struct {
	start time.Time

	mu        sync.Mutex
	requests  map[seriesKey]uint64
	hist      map[string]*routeHist // keyed by route template
	rlReject  map[string]uint64     // rate-limit (429) rejections by route
	inFlight  int64                 // atomic
	totalReqs uint64                // atomic; for lifetime QPS
}

func newMetrics() *metrics {
	return &metrics{
		start:    time.Now(),
		requests: make(map[seriesKey]uint64),
		hist:     make(map[string]*routeHist),
		rlReject: make(map[string]uint64),
	}
}

// routeTemplate returns the matched route's registered template. Falls back to
// the method-less "unmatched" bucket so 404s cannot explode cardinality with
// attacker-controlled paths.
func routeTemplate(c fiber.Ctx) string {
	if r := c.Route(); r != nil && r.Path != "" {
		return r.Path
	}
	return "unmatched"
}

// middleware times every request, records the series, and emits one structured
// log line. Registered high in the chain (after requestid) so it wraps the whole
// handler stack including downstream errors.
func (m *metrics) middleware() fiber.Handler {
	return func(c fiber.Ctx) error {
		start := time.Now()
		atomic.AddInt64(&m.inFlight, 1)

		err := c.Next()

		atomic.AddInt64(&m.inFlight, -1)
		atomic.AddUint64(&m.totalReqs, 1)
		latency := time.Since(start)
		status := c.Response().StatusCode()
		route := routeTemplate(c)
		method := c.Method()

		m.record(method, route, status, latency)

		attrs := []any{
			"request_id", requestid.FromContext(c),
			"method", method,
			"route", route,
			"status", status,
			"latency_ms", latency.Milliseconds(),
		}
		// tenant id is an identifier, not a secret; empty on public routes.
		if uid := currentUserID(c); uid != "" {
			attrs = append(attrs, "tenant", uid)
		}
		switch {
		case status >= 500:
			slog.Error("request", attrs...)
		case status >= 400:
			slog.Warn("request", attrs...)
		default:
			slog.Info("request", attrs...)
		}
		return err
	}
}

func (m *metrics) record(method, route string, status int, latency time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.requests[seriesKey{method, route, status}]++

	h := m.hist[route]
	if h == nil {
		h = &routeHist{}
		m.hist[route] = h
	}
	secs := latency.Seconds()
	h.sum += secs
	h.count++
	for i, ub := range latencyBucketsSeconds {
		if secs <= ub {
			h.counts[i]++
		}
	}
	h.counts[len(latencyBucketsSeconds)]++ // +Inf

	if status == fiber.StatusTooManyRequests {
		m.rlReject[route]++
	}
}

// escapeLabel escapes a Prometheus label value (backslash, quote, newline).
func escapeLabel(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	return s
}

// expose renders the current registry in Prometheus text exposition format.
func (m *metrics) expose() string {
	m.mu.Lock()
	// snapshot under lock, render after
	reqs := make([]seriesKey, 0, len(m.requests))
	reqVals := make(map[seriesKey]uint64, len(m.requests))
	for k, v := range m.requests {
		reqs = append(reqs, k)
		reqVals[k] = v
	}
	routes := make([]string, 0, len(m.hist))
	histCopy := make(map[string]routeHist, len(m.hist))
	for r, h := range m.hist {
		routes = append(routes, r)
		histCopy[r] = *h
	}
	rlRoutes := make([]string, 0, len(m.rlReject))
	rlVals := make(map[string]uint64, len(m.rlReject))
	for r, v := range m.rlReject {
		rlRoutes = append(rlRoutes, r)
		rlVals[r] = v
	}
	m.mu.Unlock()

	inFlight := atomic.LoadInt64(&m.inFlight)
	total := atomic.LoadUint64(&m.totalReqs)
	uptime := time.Since(m.start).Seconds()
	var qps float64
	if uptime > 0 {
		qps = float64(total) / uptime
	}

	sort.Slice(reqs, func(i, j int) bool {
		if reqs[i].route != reqs[j].route {
			return reqs[i].route < reqs[j].route
		}
		if reqs[i].method != reqs[j].method {
			return reqs[i].method < reqs[j].method
		}
		return reqs[i].status < reqs[j].status
	})
	sort.Strings(routes)
	sort.Strings(rlRoutes)

	var b strings.Builder

	b.WriteString("# HELP verity_gateway_requests_total Total HTTP requests by method, route and status.\n")
	b.WriteString("# TYPE verity_gateway_requests_total counter\n")
	for _, k := range reqs {
		fmt.Fprintf(&b, "verity_gateway_requests_total{method=\"%s\",route=\"%s\",status=\"%d\"} %d\n",
			escapeLabel(k.method), escapeLabel(k.route), k.status, reqVals[k])
	}

	b.WriteString("# HELP verity_gateway_request_duration_seconds Request latency histogram by route.\n")
	b.WriteString("# TYPE verity_gateway_request_duration_seconds histogram\n")
	for _, r := range routes {
		h := histCopy[r]
		rl := escapeLabel(r)
		for i, ub := range latencyBucketsSeconds {
			fmt.Fprintf(&b, "verity_gateway_request_duration_seconds_bucket{route=\"%s\",le=\"%s\"} %d\n",
				rl, strconv.FormatFloat(ub, 'g', -1, 64), h.counts[i])
		}
		fmt.Fprintf(&b, "verity_gateway_request_duration_seconds_bucket{route=\"%s\",le=\"+Inf\"} %d\n",
			rl, h.counts[len(latencyBucketsSeconds)])
		fmt.Fprintf(&b, "verity_gateway_request_duration_seconds_sum{route=\"%s\"} %s\n",
			rl, strconv.FormatFloat(h.sum, 'g', -1, 64))
		fmt.Fprintf(&b, "verity_gateway_request_duration_seconds_count{route=\"%s\"} %d\n", rl, h.count)
	}

	b.WriteString("# HELP verity_gateway_in_flight_requests Requests currently being served.\n")
	b.WriteString("# TYPE verity_gateway_in_flight_requests gauge\n")
	fmt.Fprintf(&b, "verity_gateway_in_flight_requests %d\n", inFlight)

	b.WriteString("# HELP verity_gateway_requests_per_second Lifetime average request rate (total/uptime).\n")
	b.WriteString("# TYPE verity_gateway_requests_per_second gauge\n")
	fmt.Fprintf(&b, "verity_gateway_requests_per_second %s\n", strconv.FormatFloat(qps, 'g', -1, 64))

	b.WriteString("# HELP verity_gateway_ratelimit_rejections_total Requests rejected with 429 by route.\n")
	b.WriteString("# TYPE verity_gateway_ratelimit_rejections_total counter\n")
	for _, r := range rlRoutes {
		fmt.Fprintf(&b, "verity_gateway_ratelimit_rejections_total{route=\"%s\"} %d\n", escapeLabel(r), rlVals[r])
	}

	return b.String()
}

// registerMetrics mounts GET /metrics on the app (unauthenticated, aggregate
// only). Mounted outside the /v1 auth group by design.
func (m *metrics) registerMetrics(app *fiber.App) {
	app.Get("/metrics", func(c fiber.Ctx) error {
		c.Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		return c.SendString(m.expose())
	})
}
