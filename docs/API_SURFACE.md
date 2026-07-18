# Verity v2 — Gateway API surface (v1)

Single source of truth for the HTTP contract between `apps/web` and `services/gateway`.
Frontend builds against this contract; backend wiring implements it. If a route says
**planned**, the frontend ships a typed client for it behind a mock adapter and flips to
live when the route lands. Do not invent routes not listed here — extend this file first.

Auth: Clerk JWT as `Authorization: Bearer <token>` (dev-mode escape when Clerk keys are
absent — gateway issues `dev-user`). All `/v1/*` routes require auth. Errors are
`{"error": "<user-safe message>"}` with proper status codes.

## Exists today

| Route | Shape |
|---|---|
| `GET /healthz` | `{ok, missing: [config keys]}` — degrade report, no auth |
| `GET /v1/hello` | spine check |
| `POST /v1/chat` | body `{conversation_id?, message, provider?, model?, memory?}` → SSE: `delta {text}` · `usage {input_tokens, output_tokens}` · `confidence {score, band}` · `error {error}` · `done {}` |
| `POST /v1/flows` | body `{task, flow?}` → SSE: role-tagged events (conductor/worker/inspector), BOP-sanitized, then `done` |
| `POST /v1/compute/jobs` | submit compute-network job (M7) |

## Planned — persistence & platform wiring pass

| Route | Shape |
|---|---|
| `GET /v1/conversations` | `?cursor=` → `{items: [{id, title, updated_at}], next_cursor}` |
| `POST /v1/conversations` | `{title?}` → `{id}` |
| `GET /v1/conversations/:id` | `{id, title, messages: [{id, role, content, created_at, confidence?}]}` (windowed) |
| `PATCH /v1/conversations/:id` | `{title}` |
| `DELETE /v1/conversations/:id` | — |
| `POST /v1/messages/:id/regenerate` | → SSE (same events as chat); replaces assistant message |
| `PATCH /v1/messages/:id` | `{content}` — edit a user message; truncates below, → SSE regen |
| `POST /v1/branches` | `{message_id, kind: "flow"\|"office", brief?}` → `{run_id}` — carries conversation context as task brief |
| `GET /v1/offices` · `POST /v1/offices` | office CRUD `{id, name, schedule, brief, status}` |
| `POST /v1/offices/:id/run` → `{run_id}` · `GET /v1/offices/:id/runs/:run_id` | run + STATE checkpoint view |
| `GET /v1/skills` | installed SKILL.md/plugin list (execution route gated on sandbox hardening) |
| `GET /v1/mcp/servers` · `POST /v1/mcp/servers` | user MCP servers; `POST /v1/mcp/call` `{server_id, tool, args}` — per-tool consent enforced server-side |
| `POST /v1/upload` | multipart file → markitdown → `{file_id, name, markdown_bytes}`; referenced from chat as `{file_id}` in body `files: []` |
| `GET /v1/provider-keys` · `PUT /v1/provider-keys/:provider` · `DELETE /v1/provider-keys/:provider` | vault-backed (AES-256-GCM); PUT body `{key}`; GET returns providers + `configured: bool`, never key material |
| `GET /v1/me` | `{user_id, providers: [{id, configured, house: bool}]}` |
| `GET /v1/transcripts/:share_id` | read-only shared transcript (public, tokenized id) |

Additions to chat SSE in the same pass: a first event `meta {conversation_id, message_id, title?}`
so new conversations surface their id/auto-name to the client.

## SSE conventions

`event: <name>\ndata: <json>\n\n`; stream ends with `done` or `error`; client stop =
connection abort (server cancels upstream). Reconnect/resume is not offered in Stage A.
