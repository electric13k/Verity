// Compute network (M7): the user-facing job-submission surface. A signed-in
// user submits an inference job; the gateway injects tenant context into gRPC
// metadata and forwards to the coordinator (Rust core), which owns
// redundancy-2 assignment, consensus and the credit ledger.
//
// Node-facing RPCs (register/claim/result/credits) are NOT proxied here —
// volunteer daemons speak to the coordinator directly. This route only
// carries the job owner's own request.
package main

import (
	"time"

	"github.com/gofiber/fiber/v3"

	verityv1 "github.com/electric13k/verity/packages/proto/gen/go/verity/v1"
)

type submitJobRequest struct {
	Model  string `json:"model" validate:"required,min=1,max=120"`
	Prompt string `json:"prompt" validate:"required,min=1,max=32000"`
}

func (s *spine) registerCompute(v1 fiber.Router) {
	// Job submission gets its own (tighter) bucket on top of the api bucket.
	v1.Post("/compute/jobs", func(c fiber.Ctx) error {
		payload, err := decodeStrict[submitJobRequest](c)
		if err != nil {
			return badRequest(c, err)
		}
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		resp, err := s.coord.SubmitJob(ctx, &verityv1.SubmitJobRequest{
			Model:  payload.Model,
			Prompt: payload.Prompt,
		})
		if err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"error": "coordinator unavailable", "detail": grpcUserMessage(err),
			})
		}
		return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
			"job_id":       resp.JobId,
			"work_unit_id": resp.WorkUnitId,
		})
	}, rateLimit("compute", 30, 10))
}
