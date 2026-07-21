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
	"google.golang.org/grpc/codes"
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

// grpcHTTPStatus maps a brain gRPC code to the HTTP status the gateway returns.
// Unknown/transport failures degrade to 503 (upstream unavailable).
func grpcHTTPStatus(err error) int {
	s, ok := status.FromError(err)
	if !ok {
		return fiber.StatusServiceUnavailable
	}
	switch s.Code() {
	case codes.OK:
		return fiber.StatusOK
	case codes.InvalidArgument:
		return fiber.StatusBadRequest
	case codes.NotFound:
		return fiber.StatusNotFound
	case codes.PermissionDenied:
		return fiber.StatusForbidden
	case codes.Unauthenticated:
		return fiber.StatusUnauthorized
	case codes.FailedPrecondition:
		return fiber.StatusPreconditionFailed
	case codes.Unavailable:
		return fiber.StatusServiceUnavailable
	case codes.DeadlineExceeded:
		return fiber.StatusGatewayTimeout
	default:
		return fiber.StatusInternalServerError
	}
}

type chatRequest struct {
	ConversationID string   `json:"conversation_id" validate:"omitempty,uuid4"`
	Message        string   `json:"message" validate:"required,min=1,max=32000"`
	Model          string   `json:"model" validate:"omitempty,max=120"`
	UseMemory      bool     `json:"use_memory"`
	FileIDs        []string `json:"files" validate:"omitempty,max=16,dive,uuid4"`
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

// chatChunkClient is the common shape of the brain's ChatStream /
// RegenerateMessage / EditMessage server-streams — all yield *ChatChunk.
type chatChunkClient interface {
	Recv() (*verityv1.ChatChunk, error)
}

// streamChatChunks pumps a brain ChatChunk stream to the client as SSE. The
// first chunk is a `meta` event (conversation id + message id + optional
// auto-name); then delta / usage / confidence; then `done` (or `error`).
func streamChatChunks(w *bufio.Writer, stream chatChunkClient) {
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
		case *verityv1.ChatChunk_Meta:
			if sseEvent(w, "meta", fiber.Map{
				"conversation_id": p.Meta.ConversationId,
				"message_id":      p.Meta.MessageId,
				"title":           p.Meta.Title,
			}) != nil {
				return
			}
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
		case *verityv1.ChatChunk_ToolActivity:
			// G1: sanitized tool-use activity (BOP: machinery redacted upstream).
			if sseEvent(w, "tool", fiber.Map{
				"tool":    p.ToolActivity.Tool,
				"summary": p.ToolActivity.Summary,
				"phase":   p.ToolActivity.Phase,
			}) != nil {
				return
			}
		}
	}
}

func setSSEHeaders(c fiber.Ctx) {
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")
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
			FileIds:        payload.FileIDs,
		})
		if err != nil {
			cancel()
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "brain unreachable"})
		}

		setSSEHeaders(c)
		return c.SendStreamWriter(func(w *bufio.Writer) {
			defer cancel()
			streamChatChunks(w, stream)
		})
	}
	// Chat has its own (tighter) bucket on top of the group-level api bucket.
	// The limiter MUST precede the handler: the SSE handler returns via
	// SendStreamWriter without calling c.Next(), so any middleware registered
	// AFTER it never runs. Order is [rateLimit, handler].
	v1.Post("/chat", rateLimit("chat", 60, 10), handler)
}
