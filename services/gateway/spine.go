// gRPC spine: gateway → brain → core. The gateway is the only place that
// dials brain/core, and the only place that writes verity metadata
// (x-verity-request-id now; x-verity-user-id / x-verity-org-id once auth
// lands in M2 — services downstream trust metadata, never bodies).
package main

import (
	"context"
	"os"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"

	verityv1 "github.com/electric13k/verity/packages/proto/gen/go/verity/v1"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type spine struct {
	brain verityv1.BrainServiceClient
	// coord is the compute-network coordinator, served by the Rust core. Only
	// the user-facing SubmitJob is exposed through the gateway; node-facing
	// RPCs (register/claim/result) are spoken directly by the node daemon.
	coord verityv1.CoordinatorServiceClient
}

// newSpine dials brain and core lazily (grpc.NewClient connects on first RPC),
// so a missing upstream degrades requests, never boot. mTLS lands at Stage C.
func newSpine() (*spine, error) {
	brainAddr := envOr("BRAIN_GRPC_ADDR", "127.0.0.1:9100")
	brainConn, err := grpc.NewClient(brainAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}
	coreAddr := envOr("CORE_GRPC_ADDR", "127.0.0.1:9200")
	coreConn, err := grpc.NewClient(coreAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}
	return &spine{
		brain: verityv1.NewBrainServiceClient(brainConn),
		coord: verityv1.NewCoordinatorServiceClient(coreConn),
	}, nil
}

// outgoingCtx carries the tenant ctx and request id downstream. This is
// the ONLY place verity metadata is written; brain and core trust it and
// nothing else for identity.
func outgoingCtx(c fiber.Ctx, timeout time.Duration) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(c.Context(), timeout)
	md := metadata.Pairs(
		"x-verity-request-id", requestid.FromContext(c),
		"x-verity-user-id", currentUserID(c),
		"x-verity-org-id", currentOrgID(c),
	)
	return metadata.NewOutgoingContext(ctx, md), cancel
}

func (s *spine) registerRoutes(v1 fiber.Router) {
	// M1 hello-path: proves gateway → brain → core round trip.
	v1.Get("/hello", func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 5*time.Second)
		defer cancel()
		resp, err := s.brain.Hello(ctx, &verityv1.HelloRequest{Message: c.Query("message", "ping")})
		if err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"error": "brain unreachable", "detail": err.Error(),
			})
		}
		return c.JSON(fiber.Map{"message": resp.Message, "core_echo": resp.CoreEcho})
	})
}
