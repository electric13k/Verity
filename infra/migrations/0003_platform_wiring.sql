-- 0003_platform_wiring.sql — persistence & platform wiring pass
--
-- Additive only (0001/0002 are never edited). Adds the three tables the
-- platform surface needs that schema v1 did not define:
--   * files        — uploaded documents converted to markdown (markitdown),
--     referenced from chat as files:[{file_id}]. Content is sanitized before
--     any prompt use; the row stores the markdown for re-reference.
--   * mcp_servers  — user-connected MCP servers (streamable HTTP). base_url is
--     user-supplied and SSRF-guarded at call time in the brain.
--   * mcp_consent  — per-(user, server, tool) consent grants. MCP tool calls
--     are refused server-side unless a matching grant exists (fail closed).
--
-- Tenant law: every table carries user_id and every query filters on it using
-- the gateway-injected tenant_ctx. The cross-tenant CI corpus proves it.

begin;

-- Uploaded files: markitdown output kept for re-reference from chat.
create table files (
    id            uuid primary key default gen_random_uuid(),
    user_id       text not null references users(id) on delete cascade,
    name          text not null,
    content_type  text,
    markdown      text not null default '',   -- markitdown output (sanitized on use)
    byte_size     int not null default 0,     -- size of the markdown payload
    created_at    timestamptz not null default now()
);
create index files_user_idx on files (user_id, created_at desc);

-- User-connected MCP servers (streamable HTTP / JSON-RPC).
create table mcp_servers (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    name        text not null,
    base_url    text not null,
    created_at  timestamptz not null default now(),
    unique (user_id, name)
);
create index mcp_servers_user_idx on mcp_servers (user_id);

-- Per-tool consent grants. A tools/call is refused unless a row exists for
-- (user_id, server_id, tool). Consent state lives in the DB (plan §5).
create table mcp_consent (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    server_id   uuid not null references mcp_servers(id) on delete cascade,
    tool        text not null,
    created_at  timestamptz not null default now(),
    unique (user_id, server_id, tool)
);
create index mcp_consent_user_idx on mcp_consent (user_id, server_id);

-- Transcript sharing (P7): every conversation gets an unguessable, tokened
-- share id at creation. GET /v1/transcripts/:share_id is a PUBLIC, read-only
-- view keyed solely by this token — no auth, no tenant filter — so the token
-- itself is the read capability. 16 random bytes (128 bits) hex-encoded.
alter table conversations
    add column share_id text not null unique
    default encode(gen_random_bytes(16), 'hex');

commit;
