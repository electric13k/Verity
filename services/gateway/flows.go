// Flows: POST /v1/flows — bridges the brain's RunFlow stream to the client
// as SSE (one event per role/phase). Runs behind requireAuth + flow bucket.
package main

import (
	"bufio"
	"errors"
	"io"
	"time"

	"github.com/gofiber/fiber/v3"

	verityv1 "github.com/electric13k/verity/packages/proto/gen/go/verity/v1"
)

type flowRequest struct {
	Task     string `json:"task" validate:"required,min=1,max=32000"`
	FlowKind string `json:"flow_kind" validate:"omitempty,oneof=converge diverge_converge"`
	Model    string `json:"model" validate:"omitempty,max=120"`
	Workers  uint32 `json:"workers" validate:"omitempty,max=4"`
}

func (s *spine) registerFlows(v1 fiber.Router) {
	handler := func(c fiber.Ctx) error {
		payload, err := decodeStrict[flowRequest](c)
		if err != nil {
			return badRequest(c, err)
		}
		ctx, cancel := outgoingCtx(c, 30*time.Minute)
		stream, err := s.brain.RunFlow(ctx, &verityv1.FlowRequest{
			Task:     payload.Task,
			FlowKind: payload.FlowKind,
			Model:    payload.Model,
			Workers:  payload.Workers,
		})
		if err != nil {
			cancel()
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "brain unreachable"})
		}

		c.Set("Content-Type", "text/event-stream")
		c.Set("Cache-Control", "no-cache")
		c.Set("X-Accel-Buffering", "no")

		return c.SendStreamWriter(func(w *bufio.Writer) {
			defer cancel()
			for {
				event, err := stream.Recv()
				if err != nil {
					if !errors.Is(err, io.EOF) {
						_ = sseEvent(w, "error", fiber.Map{"error": grpcUserMessage(err)})
					}
					_ = sseEvent(w, "done", fiber.Map{})
					return
				}
				if sseEvent(w, "flow", fiber.Map{
					"role":    event.Role,
					"phase":   event.Phase,
					"content": event.Content,
				}) != nil {
					return
				}
			}
		})
	}
	// Flows are heavier than chat: tighter bucket. The limiter MUST precede the
	// handler — the SSE handler never calls c.Next(), so a limiter registered
	// after it is dead code. Order is [rateLimit, handler].
	v1.Post("/flows", rateLimit("flow", 20, 5), handler)
}
