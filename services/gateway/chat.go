// Chat: POST /v1/chat — bridges the brain's ChatStream gRPC stream to the
// client as Server-Sent Events. Runs behind requireAuth + the chat bucket.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc/status"

	verityv1 "github.com/electric13k/verity/packages/proto/gen/go/verity/v1"
)

// grpcUserMessage returns only the status message (our aborts are written
// to be user-safe); transport internals never reach the client.
func grpcUserMessage(err error) string {
	if s, ok := status.FromError(err); ok {
		return s.Message()
	}
	return "upstream error"
}

type chatRequest struct {
	ConversationID string `json:"conversation_id" validate:"omitempty,uuid4"`
	Message        string `json:"message" validate:"required,min=1,max=32000"`
	Model          string `json:"model" validate:"omitempty,max=120"`
	UseMemory      bool   `json:"use_memory"`
}

func sseEvent(w *bufio.Writer, event string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data); err != nil {
		return err
	}
	return w.Flush()
}

func (s *spine) registerChat(v1 fiber.Router) {
	handler := func(c fiber.Ctx) error {
		payload, err := decodeStrict[chatRequest](c)
		if err != nil {
			return badRequest(c, err)
		}

		ctx, cancel := outgoingCtx(c, 10*time.Minute)
		stream, err := s.brain.ChatStream(ctx, &verityv1.ChatRequest{
			ConversationId: payload.ConversationID,
			UserMessage:    payload.Message,
			Model:          payload.Model,
			UseMemory:      payload.UseMemory,
		})
		if err != nil {
			cancel()
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "brain unreachable"})
		}

		c.Set("Content-Type", "text/event-stream")
		c.Set("Cache-Control", "no-cache")
		c.Set("Connection", "keep-alive")
		c.Set("X-Accel-Buffering", "no")

		return c.SendStreamWriter(func(w *bufio.Writer) {
			defer cancel()
			for {
				chunk, err := stream.Recv()
				if err != nil {
					// io.EOF = clean end; anything else is surfaced then closed.
					if !errors.Is(err, io.EOF) {
						_ = sseEvent(w, "error", fiber.Map{"error": grpcUserMessage(err)})
					}
					_ = sseEvent(w, "done", fiber.Map{})
					return
				}
				switch p := chunk.Payload.(type) {
				case *verityv1.ChatChunk_Delta:
					if sseEvent(w, "delta", fiber.Map{"text": p.Delta}) != nil {
						return // client went away; cancel() tears down the gRPC stream
					}
				case *verityv1.ChatChunk_Usage:
					_ = sseEvent(w, "usage", fiber.Map{
						"input_tokens":  p.Usage.InputTokens,
						"output_tokens": p.Usage.OutputTokens,
					})
				case *verityv1.ChatChunk_Confidence:
					_ = sseEvent(w, "confidence", fiber.Map{
						"score":     p.Confidence.Score,
						"rationale": p.Confidence.Rationale,
					})
				}
			}
		})
	}
	// Chat has its own (tighter) bucket on top of the group-level api bucket.
	// The limiter MUST precede the handler: the SSE handler returns via
	// SendStreamWriter without calling c.Next(), so any middleware registered
	// AFTER it never runs. Order is [rateLimit, handler].
	v1.Post("/chat", rateLimit("chat", 60, 10), handler)
}
