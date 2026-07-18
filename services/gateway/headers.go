// Security headers (L1/L2). The gateway is an API origin; the CSP matters
// most for anything HTML it ever serves and as defense in depth. The web
// app's own CSP ships with its Stage B Pages deploy (plan §2).
package main

import "github.com/gofiber/fiber/v3"

func securityHeaders() fiber.Handler {
	return func(c fiber.Ctx) error {
		c.Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data: blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'")
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("Referrer-Policy", "no-referrer")
		c.Set("Cross-Origin-Opener-Policy", "same-origin")
		// HSTS is meaningful once TLS terminates in front (Stage B/C); a
		// no-op over plain HTTP.
		c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		return c.Next()
	}
}
