// Platform routes: the persistence & platform surface (conversations, provider
// keys, offices, skills, MCP, upload, branching, transcripts) proxied to the
// brain's PlatformService over gRPC. Tenant identity rides in gRPC metadata
// (outgoingCtx) — brain re-checks ownership and never trusts request bodies.
//
// Rate limits: light CRUD rides the group `api` bucket; heavier classes
// (office runs, upload, mcp/call) get their own tighter bucket, registered
// BEFORE the handler (Fiber v3 ordering — see chat.go).
package main

import (
	"bufio"
	"encoding/json"
	"io"
	"time"

	"github.com/gofiber/fiber/v3"

	verityv1 "github.com/electric13k/verity/packages/proto/gen/go/verity/v1"
)

// --- request payloads (strict validation, unknown fields rejected) ---------

type createConversationRequest struct {
	Title string `json:"title" validate:"omitempty,max=200"`
}

type patchConversationRequest struct {
	Title string `json:"title" validate:"required,min=1,max=200"`
}

type editMessageRequest struct {
	Content string `json:"content" validate:"required,min=1,max=32000"`
	Model   string `json:"model" validate:"omitempty,max=120"`
	Memory  bool   `json:"memory"`
}

type regenerateRequest struct {
	Model  string `json:"model" validate:"omitempty,max=120"`
	Memory bool   `json:"memory"`
}

type createBranchRequest struct {
	MessageID string `json:"message_id" validate:"required,uuid4"`
	Kind      string `json:"kind" validate:"required,oneof=flow office"`
	Brief     string `json:"brief" validate:"omitempty,max=8000"`
}

type createOfficeRequest struct {
	Name     string `json:"name" validate:"required,min=1,max=120"`
	Schedule string `json:"schedule" validate:"omitempty,max=120"`
	Brief    string `json:"brief" validate:"required,min=1,max=8000"`
	FlowKind string `json:"flow_kind" validate:"omitempty,oneof=converge diverge_converge"`
	Model    string `json:"model" validate:"omitempty,max=120"`
	Workers  uint32 `json:"workers" validate:"omitempty,max=4"`
}

type putProviderKeyRequest struct {
	Key string `json:"key" validate:"required,min=1,max=8000"`
}

type createMcpServerRequest struct {
	Name    string `json:"name" validate:"required,min=1,max=120"`
	BaseURL string `json:"base_url" validate:"required,url,max=2000"`
}

type mcpCallRequest struct {
	ServerID string          `json:"server_id" validate:"required,uuid4"`
	Tool     string          `json:"tool" validate:"required,min=1,max=200"`
	Args     json.RawMessage `json:"args" validate:"omitempty"`
	Consent  bool            `json:"consent"`
}

// --- helpers ---------------------------------------------------------------

// upstreamErr maps a brain gRPC error to an HTTP response. The status message
// is written by the brain to be user-safe; transport internals never leak.
func upstreamErr(c fiber.Ctx, err error) error {
	return c.Status(grpcHTTPStatus(err)).JSON(fiber.Map{"error": grpcUserMessage(err)})
}

func pbMessageJSON(m *verityv1.Message) fiber.Map {
	out := fiber.Map{
		"id":         m.Id,
		"role":       m.Role,
		"content":    m.Content,
		"created_at": m.CreatedAt,
	}
	if m.HasConfidence {
		out["confidence"] = m.Confidence
	}
	return out
}

func (s *spine) registerPlatform(v1 fiber.Router) {
	s.registerConversations(v1)
	s.registerMessages(v1)
	s.registerProviderKeys(v1)
	s.registerOffices(v1)
	s.registerSkillsMCP(v1)
	s.registerUploadBranch(v1)
}

// --- conversations ---------------------------------------------------------

func (s *spine) registerConversations(v1 fiber.Router) {
	v1.Get("/conversations", func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		resp, err := s.platform.ListConversations(ctx, &verityv1.ListConversationsRequest{
			Cursor: c.Query("cursor"),
		})
		if err != nil {
			return upstreamErr(c, err)
		}
		items := make([]fiber.Map, 0, len(resp.Items))
		for _, it := range resp.Items {
			items = append(items, fiber.Map{
				"id": it.Id, "title": it.Title, "updated_at": it.UpdatedAt,
			})
		}
		return c.JSON(fiber.Map{"items": items, "next_cursor": resp.NextCursor})
	})

	v1.Post("/conversations", func(c fiber.Ctx) error {
		payload, err := decodeStrict[createConversationRequest](c)
		if err != nil {
			return badRequest(c, err)
		}
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		conv, err := s.platform.CreateConversation(ctx, &verityv1.CreateConversationRequest{
			Title: payload.Title,
		})
		if err != nil {
			return upstreamErr(c, err)
		}
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": conv.Id})
	})

	v1.Get("/conversations/:id", func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		detail, err := s.platform.GetConversation(ctx, &verityv1.IdRequest{Id: c.Params("id")})
		if err != nil {
			return upstreamErr(c, err)
		}
		msgs := make([]fiber.Map, 0, len(detail.Messages))
		for _, m := range detail.Messages {
			msgs = append(msgs, pbMessageJSON(m))
		}
		return c.JSON(fiber.Map{
			"id": detail.Id, "title": detail.Title,
			"share_id": detail.ShareId, "messages": msgs,
		})
	})

	v1.Patch("/conversations/:id", func(c fiber.Ctx) error {
		payload, err := decodeStrict[patchConversationRequest](c)
		if err != nil {
			return badRequest(c, err)
		}
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		conv, err := s.platform.UpdateConversation(ctx, &verityv1.UpdateConversationRequest{
			Id: c.Params("id"), Title: payload.Title,
		})
		if err != nil {
			return upstreamErr(c, err)
		}
		return c.JSON(fiber.Map{"id": conv.Id, "title": conv.Title, "updated_at": conv.UpdatedAt})
	})

	v1.Delete("/conversations/:id", func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		if _, err := s.platform.DeleteConversation(ctx, &verityv1.IdRequest{Id: c.Params("id")}); err != nil {
			return upstreamErr(c, err)
		}
		return c.SendStatus(fiber.StatusNoContent)
	})
}

// --- messages: regenerate + edit (SSE, same events as chat) ---------------

func (s *spine) registerMessages(v1 fiber.Router) {
	regen := func(c fiber.Ctx) error {
		payload, err := decodeStrict[regenerateRequest](c)
		if err != nil {
			return badRequest(c, err)
		}
		ctx, cancel := outgoingCtx(c, 10*time.Minute)
		stream, err := s.brain.RegenerateMessage(ctx, &verityv1.RegenerateRequest{
			MessageId: c.Params("id"), Model: payload.Model, UseMemory: payload.Memory,
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
	edit := func(c fiber.Ctx) error {
		payload, err := decodeStrict[editMessageRequest](c)
		if err != nil {
			return badRequest(c, err)
		}
		ctx, cancel := outgoingCtx(c, 10*time.Minute)
		stream, err := s.brain.EditMessage(ctx, &verityv1.EditMessageRequest{
			MessageId: c.Params("id"), Content: payload.Content,
			Model: payload.Model, UseMemory: payload.Memory,
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
	// Both restream an assistant turn — chat's cost profile, so chat's bucket.
	v1.Post("/messages/:id/regenerate", rateLimit("chat", 60, 10), regen)
	v1.Patch("/messages/:id", rateLimit("chat", 60, 10), edit)
}

// --- provider keys ---------------------------------------------------------

func (s *spine) registerProviderKeys(v1 fiber.Router) {
	v1.Get("/provider-keys", func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		resp, err := s.platform.ListProviderKeys(ctx, &verityv1.Empty{})
		if err != nil {
			return upstreamErr(c, err)
		}
		providers := make([]fiber.Map, 0, len(resp.Providers))
		for _, p := range resp.Providers {
			providers = append(providers, fiber.Map{"provider": p.Provider, "configured": p.Configured})
		}
		return c.JSON(fiber.Map{"providers": providers})
	})

	v1.Put("/provider-keys/:provider", func(c fiber.Ctx) error {
		payload, err := decodeStrict[putProviderKeyRequest](c)
		if err != nil {
			return badRequest(c, err)
		}
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		st, err := s.platform.PutProviderKey(ctx, &verityv1.PutProviderKeyRequest{
			Provider: c.Params("provider"), Key: payload.Key,
		})
		if err != nil {
			return upstreamErr(c, err)
		}
		return c.JSON(fiber.Map{"provider": st.Provider, "configured": st.Configured})
	})

	v1.Delete("/provider-keys/:provider", func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		if _, err := s.platform.DeleteProviderKey(ctx, &verityv1.ProviderRequest{Provider: c.Params("provider")}); err != nil {
			return upstreamErr(c, err)
		}
		return c.SendStatus(fiber.StatusNoContent)
	})

	v1.Get("/me", func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		me, err := s.platform.GetMe(ctx, &verityv1.Empty{})
		if err != nil {
			return upstreamErr(c, err)
		}
		providers := make([]fiber.Map, 0, len(me.Providers))
		for _, p := range me.Providers {
			providers = append(providers, fiber.Map{
				"id": p.Id, "configured": p.Configured, "house": p.House,
			})
		}
		return c.JSON(fiber.Map{"user_id": me.UserId, "providers": providers})
	})
}

// --- offices ---------------------------------------------------------------

func officeJSON(o *verityv1.Office) fiber.Map {
	return fiber.Map{
		"id": o.Id, "name": o.Name, "schedule": o.Schedule,
		"brief": o.Brief, "status": o.Status,
	}
}

func (s *spine) registerOffices(v1 fiber.Router) {
	v1.Get("/offices", func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		resp, err := s.platform.ListOffices(ctx, &verityv1.Empty{})
		if err != nil {
			return upstreamErr(c, err)
		}
		items := make([]fiber.Map, 0, len(resp.Items))
		for _, o := range resp.Items {
			items = append(items, officeJSON(o))
		}
		return c.JSON(fiber.Map{"items": items})
	})

	v1.Post("/offices", func(c fiber.Ctx) error {
		payload, err := decodeStrict[createOfficeRequest](c)
		if err != nil {
			return badRequest(c, err)
		}
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		o, err := s.platform.CreateOffice(ctx, &verityv1.CreateOfficeRequest{
			Name: payload.Name, Schedule: payload.Schedule, Brief: payload.Brief,
			FlowKind: payload.FlowKind, Model: payload.Model, Workers: payload.Workers,
		})
		if err != nil {
			return upstreamErr(c, err)
		}
		return c.Status(fiber.StatusCreated).JSON(officeJSON(o))
	})

	// Running an office fans out to workers — its own (tighter) bucket.
	v1.Post("/offices/:id/run", rateLimit("office", 20, 5), func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 30*time.Second)
		defer cancel()
		resp, err := s.platform.RunOffice(ctx, &verityv1.IdRequest{Id: c.Params("id")})
		if err != nil {
			return upstreamErr(c, err)
		}
		return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"run_id": resp.RunId})
	})

	v1.Get("/offices/:id/runs/:run_id", func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		run, err := s.platform.GetOfficeRun(ctx, &verityv1.GetOfficeRunRequest{
			OfficeId: c.Params("id"), RunId: c.Params("run_id"),
		})
		if err != nil {
			return upstreamErr(c, err)
		}
		return c.JSON(fiber.Map{
			"run_id": run.RunId, "office_id": run.OfficeId, "status": run.Status,
			"state_md": run.StateMd, "started_at": run.StartedAt, "finished_at": run.FinishedAt,
		})
	})
}

// --- skills + MCP ----------------------------------------------------------

func (s *spine) registerSkillsMCP(v1 fiber.Router) {
	v1.Get("/skills", func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		resp, err := s.platform.ListSkills(ctx, &verityv1.Empty{})
		if err != nil {
			return upstreamErr(c, err)
		}
		skills := make([]fiber.Map, 0, len(resp.Skills))
		for _, sk := range resp.Skills {
			skills = append(skills, fiber.Map{"name": sk.Name, "description": sk.Description})
		}
		return c.JSON(fiber.Map{"skills": skills, "execution_available": resp.ExecutionAvailable})
	})

	v1.Get("/mcp/servers", func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		resp, err := s.platform.ListMcpServers(ctx, &verityv1.Empty{})
		if err != nil {
			return upstreamErr(c, err)
		}
		items := make([]fiber.Map, 0, len(resp.Items))
		for _, m := range resp.Items {
			items = append(items, fiber.Map{"id": m.Id, "name": m.Name, "base_url": m.BaseUrl})
		}
		return c.JSON(fiber.Map{"items": items})
	})

	v1.Post("/mcp/servers", func(c fiber.Ctx) error {
		payload, err := decodeStrict[createMcpServerRequest](c)
		if err != nil {
			return badRequest(c, err)
		}
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		m, err := s.platform.CreateMcpServer(ctx, &verityv1.CreateMcpServerRequest{
			Name: payload.Name, BaseUrl: payload.BaseURL,
		})
		if err != nil {
			return upstreamErr(c, err)
		}
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": m.Id, "name": m.Name, "base_url": m.BaseUrl})
	})

	// Tool calls reach out over the network (SSRF-guarded in brain): own bucket.
	v1.Post("/mcp/call", rateLimit("mcp", 30, 10), func(c fiber.Ctx) error {
		payload, err := decodeStrict[mcpCallRequest](c)
		if err != nil {
			return badRequest(c, err)
		}
		argsJSON := "{}"
		if len(payload.Args) > 0 {
			argsJSON = string(payload.Args)
		}
		ctx, cancel := outgoingCtx(c, 60*time.Second)
		defer cancel()
		resp, err := s.platform.McpCall(ctx, &verityv1.McpCallRequest{
			ServerId: payload.ServerID, Tool: payload.Tool,
			ArgsJson: argsJSON, Consent: payload.Consent,
		})
		if err != nil {
			return upstreamErr(c, err)
		}
		return c.JSON(fiber.Map{"output": resp.Output})
	})
}

// --- upload + branch -------------------------------------------------------

func (s *spine) registerUploadBranch(v1 fiber.Router) {
	// Upload carries a file body → markitdown in brain: own (tighter) bucket.
	v1.Post("/upload", rateLimit("upload", 20, 5), func(c fiber.Ctx) error {
		fh, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "multipart 'file' field required"})
		}
		f, err := fh.Open()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "could not read upload"})
		}
		defer f.Close()
		data, err := io.ReadAll(io.LimitReader(f, 16*1024*1024))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "could not read upload"})
		}
		ctx, cancel := outgoingCtx(c, 60*time.Second)
		defer cancel()
		resp, err := s.platform.UploadFile(ctx, &verityv1.UploadFileRequest{
			Name: fh.Filename, ContentType: fh.Header.Get("Content-Type"), Content: data,
		})
		if err != nil {
			return upstreamErr(c, err)
		}
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{
			"file_id": resp.FileId, "name": resp.Name, "markdown_bytes": resp.MarkdownBytes,
		})
	})

	v1.Post("/branches", func(c fiber.Ctx) error {
		payload, err := decodeStrict[createBranchRequest](c)
		if err != nil {
			return badRequest(c, err)
		}
		ctx, cancel := outgoingCtx(c, 15*time.Second)
		defer cancel()
		resp, err := s.platform.CreateBranch(ctx, &verityv1.CreateBranchRequest{
			MessageId: payload.MessageID, Kind: payload.Kind, Brief: payload.Brief,
		})
		if err != nil {
			return upstreamErr(c, err)
		}
		return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"run_id": resp.RunId, "kind": resp.Kind})
	})
}

// --- transcripts (PUBLIC, no auth) -----------------------------------------

// registerTranscripts mounts the public read-only transcript route directly on
// the app (NOT the /v1 auth group): the share id is the read capability, so no
// session is required. It gets its own IP-keyed bucket since there is no user
// id to key on.
func (s *spine) registerTranscripts(app *fiber.App) {
	pub := publicRateLimit("transcript", 60, 20)
	app.Get("/v1/transcripts/:share_id", pub, func(c fiber.Ctx) error {
		ctx, cancel := outgoingCtx(c, 10*time.Second)
		defer cancel()
		resp, err := s.platform.GetTranscript(ctx, &verityv1.TranscriptRequest{
			ShareId: c.Params("share_id"),
		})
		if err != nil {
			return upstreamErr(c, err)
		}
		msgs := make([]fiber.Map, 0, len(resp.Messages))
		for _, m := range resp.Messages {
			msgs = append(msgs, pbMessageJSON(m))
		}
		return c.JSON(fiber.Map{"title": resp.Title, "created_at": resp.CreatedAt, "messages": msgs})
	})
}
