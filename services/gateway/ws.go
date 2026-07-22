// WebSocket fan-out (MASTER_PLAN §1: "SSE/WS fan-out"). GET /v1/ws is an
// ALTERNATIVE to the SSE chat/flow streams for clients behind proxies that
// buffer or block Server-Sent Events, and it adds bidirectional control —
// stop / regenerate / edit over the same socket.
//
// It reuses the exact gRPC stream plumbing the SSE bridge uses (the brain's
// ChatStream / RegenerateMessage / EditMessage server-streams and the shared
// chatChunkClient shape) but replicates the bridge here rather than touching
// chat.go. Same auth + rate-limit middleware runs on the handshake GET before
// the upgrade: requireAuth (group level) sets tenant_ctx, then the ws bucket.
//
// Laws honored: tenant identity is captured from the validated token BEFORE the
// connection is hijacked (the Fiber ctx is pooled after the handler returns) and
// injected into gRPC metadata only. Every client frame is strictly validated.
// Client close cancels the upstream stream. No secret is ever logged or sent.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/fasthttp/websocket"
	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"github.com/valyala/fasthttp"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	verityv1 "github.com/electric13k/verity/packages/proto/gen/go/verity/v1"
)

const (
	wsWriteWait   = 10 * time.Second
	wsPongWait    = 60 * time.Second
	wsPingPeriod  = (wsPongWait * 9) / 10
	wsMaxMsgBytes = 64 * 1024 // a control/chat frame; not a file transport
	wsTurnTimeout = 10 * time.Minute
)

// wsIdentity is the tenant context captured at handshake time and carried for
// the whole socket lifetime (the Fiber ctx does not survive the hijack).
type wsIdentity struct {
	userID    string
	orgID     string
	email     string
	requestID string
}

// wsClientMsg is a strictly-validated inbound control frame. Fields are shared
// across message types; per-type required fields are checked in startStream.
type wsClientMsg struct {
	Type           string   `json:"type" validate:"required,oneof=chat regenerate edit stop ping"`
	ConversationID string   `json:"conversation_id" validate:"omitempty,uuid4"`
	MessageID      string   `json:"message_id" validate:"omitempty,uuid4"`
	Message        string   `json:"message" validate:"omitempty,max=32000"`
	Content        string   `json:"content" validate:"omitempty,max=32000"`
	Model          string   `json:"model" validate:"omitempty,max=120"`
	UseMemory      bool     `json:"use_memory"`
	Files          []string `json:"files" validate:"omitempty,max=16,dive,uuid4"`
}

func wsError(msg string) fiber.Map { return fiber.Map{"type": "error", "error": msg} }

// wsFrameWriter is the write surface the pump uses — an interface so the bridge
// is unit-testable without a real socket.
type wsFrameWriter interface {
	writeJSON(v any) error
}

// wsWriter serializes all writes to one connection (a websocket.Conn is not
// safe for concurrent writers) and owns the keepalive ping loop.
type wsWriter struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func (w *wsWriter) writeJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	_ = w.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
	return w.conn.WriteMessage(websocket.TextMessage, data)
}

func (w *wsWriter) pingLoop(stop <-chan struct{}) {
	t := time.NewTicker(wsPingPeriod)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			w.mu.Lock()
			_ = w.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
			err := w.conn.WriteMessage(websocket.PingMessage, nil)
			w.mu.Unlock()
			if err != nil {
				return
			}
		}
	}
}

// newWSUpgrader builds the fasthttp websocket upgrader with a CSRF-aware origin
// check. Browsers auto-attach the session cookie to the handshake, so a strict
// origin check is the primary defense against cross-site WebSocket hijacking:
//   - no Origin header (non-browser client) → allow (still auth-gated),
//   - VERITY_ALLOWED_ORIGINS set → allow only listed origins,
//   - otherwise → same-origin only.
func newWSUpgrader() *websocket.FastHTTPUpgrader {
	allowed := parseAllowedAZP(os.Getenv("VERITY_ALLOWED_ORIGINS"))
	return &websocket.FastHTTPUpgrader{
		HandshakeTimeout: 10 * time.Second,
		ReadBufferSize:   4096,
		WriteBufferSize:  4096,
		CheckOrigin: func(ctx *fasthttp.RequestCtx) bool {
			origin := string(ctx.Request.Header.Peek("Origin"))
			if origin == "" {
				return true
			}
			if allowed != nil {
				return allowed[origin]
			}
			return sameOrigin(origin, string(ctx.Host()))
		},
	}
}

func sameOrigin(origin, host string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, host)
}

// registerWS mounts GET /v1/ws. The ws rate-limit bucket precedes the handler
// (Fiber v3 ordering — the handler hijacks and never calls c.Next(), so any
// middleware after it would be dead code, exactly as for the SSE routes).
func (s *spine) registerWS(v1 fiber.Router) {
	upgrader := newWSUpgrader()
	handler := func(c fiber.Ctx) error {
		if !websocket.FastHTTPIsWebSocketUpgrade(c.RequestCtx()) {
			return c.Status(fiber.StatusUpgradeRequired).JSON(fiber.Map{"error": "websocket upgrade required"})
		}
		// Capture tenant_ctx now — Locals are invalid once the conn is hijacked.
		id := wsIdentity{
			userID:    currentUserID(c),
			orgID:     currentOrgID(c),
			email:     currentEmail(c),
			requestID: requestid.FromContext(c),
		}
		if err := upgrader.Upgrade(c.RequestCtx(), func(conn *websocket.Conn) {
			s.serveWS(conn, id)
		}); err != nil {
			// Upgrade already wrote the HTTP error response; just note it.
			slog.Warn("ws upgrade failed", "err", err)
		}
		return nil
	}
	v1.Get("/ws", rateLimit("ws", 60, 10), handler)
}

// wsBaseCtx builds the per-socket outgoing gRPC context carrying tenant_ctx.
// This is the ONLY place ws metadata is written; brain trusts it, never a body.
// It derives from context.Background() (not the request ctx, which dies at
// hijack); per-turn deadlines/cancel are layered in serveWS.
func wsBaseCtx(id wsIdentity) context.Context {
	md := metadata.Pairs(
		"x-verity-request-id", id.requestID,
		"x-verity-user-id", id.userID,
		"x-verity-org-id", id.orgID,
		"x-verity-email", id.email,
	)
	return metadata.NewOutgoingContext(context.Background(), md)
}

// serveWS is the control loop: it reads client frames, starts/stops upstream
// streams, and tears everything down on client close. Only this goroutine
// mutates `active`, so stream lifecycle is race-free; the pump goroutine only
// writes frames (through the mutex-guarded writer) and signals completion.
func (s *spine) serveWS(conn *websocket.Conn, id wsIdentity) {
	defer conn.Close()
	conn.SetReadLimit(wsMaxMsgBytes)
	_ = conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsPongWait))
	})

	w := &wsWriter{conn: conn}
	stopPing := make(chan struct{})
	go w.pingLoop(stopPing)
	defer close(stopPing)

	base := wsBaseCtx(id)

	type activePump struct {
		cancel context.CancelFunc
		done   chan struct{}
	}
	var active *activePump
	stopActive := func() {
		if active != nil {
			active.cancel()
			<-active.done // cancel forces stream.Recv to return promptly
			active = nil
		}
	}
	defer stopActive()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return // client closed / dead peer / read deadline → defer cancels upstream
		}
		msg, derr := decodeStrictBytes[wsClientMsg](data)
		if derr != nil {
			_ = w.writeJSON(wsError("invalid request"))
			continue
		}
		switch msg.Type {
		case "ping":
			_ = w.writeJSON(fiber.Map{"type": "pong"})
		case "stop":
			stopActive()
			_ = w.writeJSON(fiber.Map{"type": "stopped"})
		default: // chat | regenerate | edit
			stopActive() // one active turn per socket
			ctx, cancel := context.WithTimeout(base, wsTurnTimeout)
			stream, serr := s.startStream(ctx, msg)
			if serr != nil {
				cancel()
				if code := status.Code(serr); code == codes.InvalidArgument {
					_ = w.writeJSON(wsError(grpcUserMessage(serr)))
				} else {
					_ = w.writeJSON(wsError("brain unreachable"))
				}
				continue
			}
			done := make(chan struct{})
			active = &activePump{cancel: cancel, done: done}
			go func() {
				defer close(done)
				defer cancel()
				pumpChatToWS(w, stream)
			}()
		}
	}
}

// startStream opens the correct brain server-stream for a control frame,
// validating the per-type required fields first. Tenant identity is already in
// ctx metadata; the brain re-checks ownership.
func (s *spine) startStream(ctx context.Context, msg *wsClientMsg) (chatChunkClient, error) {
	switch msg.Type {
	case "chat":
		if msg.Message == "" {
			return nil, status.Error(codes.InvalidArgument, "message is required")
		}
		return s.brain.ChatStream(ctx, &verityv1.ChatRequest{
			ConversationId: msg.ConversationID,
			UserMessage:    msg.Message,
			Model:          msg.Model,
			UseMemory:      msg.UseMemory,
			FileIds:        msg.Files,
		})
	case "regenerate":
		if msg.MessageID == "" {
			return nil, status.Error(codes.InvalidArgument, "message_id is required")
		}
		return s.brain.RegenerateMessage(ctx, &verityv1.RegenerateRequest{
			MessageId: msg.MessageID, Model: msg.Model, UseMemory: msg.UseMemory,
		})
	case "edit":
		if msg.MessageID == "" || msg.Content == "" {
			return nil, status.Error(codes.InvalidArgument, "message_id and content are required")
		}
		return s.brain.EditMessage(ctx, &verityv1.EditMessageRequest{
			MessageId: msg.MessageID, Content: msg.Content, Model: msg.Model, UseMemory: msg.UseMemory,
		})
	}
	return nil, status.Error(codes.InvalidArgument, "unsupported message type")
}

// wsStreamCanceled reports whether a Recv error is a client-initiated
// cancellation (stop / new turn / socket close) rather than a server fault, so
// the pump can end cleanly with `done` and no spurious `error` frame.
func wsStreamCanceled(err error) bool {
	if errors.Is(err, context.Canceled) {
		return true
	}
	return status.Code(err) == codes.Canceled
}

// pumpChatToWS bridges a brain ChatChunk stream to the socket as typed JSON
// frames — the same event vocabulary as the SSE bridge (meta/delta/usage/
// confidence/tool/error/done), so a client can swap transports without changing
// its event handling.
func pumpChatToWS(w wsFrameWriter, stream chatChunkClient) {
	for {
		chunk, err := stream.Recv()
		if err != nil {
			if !errors.Is(err, io.EOF) && !wsStreamCanceled(err) {
				_ = w.writeJSON(wsError(grpcUserMessage(err)))
			}
			_ = w.writeJSON(fiber.Map{"type": "done"})
			return
		}
		switch p := chunk.Payload.(type) {
		case *verityv1.ChatChunk_Meta:
			if w.writeJSON(fiber.Map{
				"type":            "meta",
				"conversation_id": p.Meta.ConversationId,
				"message_id":      p.Meta.MessageId,
				"title":           p.Meta.Title,
			}) != nil {
				return
			}
		case *verityv1.ChatChunk_Delta:
			if w.writeJSON(fiber.Map{"type": "delta", "text": p.Delta}) != nil {
				return
			}
		case *verityv1.ChatChunk_Usage:
			_ = w.writeJSON(fiber.Map{
				"type":          "usage",
				"input_tokens":  p.Usage.InputTokens,
				"output_tokens": p.Usage.OutputTokens,
			})
		case *verityv1.ChatChunk_Confidence:
			_ = w.writeJSON(fiber.Map{
				"type":      "confidence",
				"score":     p.Confidence.Score,
				"rationale": p.Confidence.Rationale,
			})
		case *verityv1.ChatChunk_ToolActivity:
			if w.writeJSON(fiber.Map{
				"type":    "tool",
				"tool":    p.ToolActivity.Tool,
				"summary": p.ToolActivity.Summary,
				"phase":   p.ToolActivity.Phase,
			}) != nil {
				return
			}
		}
	}
}
