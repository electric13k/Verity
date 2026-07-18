-- 0001_schema_v1.sql — Verity v2 schema v1 (M2)
--
-- Tenant law: every tenant-owned table carries user_id and every service
-- query MUST filter on it using the gateway-injected tenant_ctx. The
-- cross-tenant CI corpus proves it. RLS is intentionally NOT relied on as
-- the primary boundary (service-role connections bypass it); it may be
-- added later as defense in depth.
--
-- Applied by named command only (see infra/migrations/README.md).

begin;

create extension if not exists pgcrypto;
create extension if not exists vector;

-- Users mirror the auth provider (Clerk user ids are text). Rows are
-- created lazily on first authenticated request.
create table users (
    id          text primary key,          -- clerk user id
    email       text,
    org_id      text,
    created_at  timestamptz not null default now()
);

-- User-supplied provider API keys. Ciphertext only: AES-256-GCM, encrypted
-- in the brain vault (nonce stored alongside; AAD = user_id). Plaintext
-- never touches the database or logs.
create table provider_keys (
    id              uuid primary key default gen_random_uuid(),
    user_id         text not null references users(id) on delete cascade,
    provider        text not null,         -- anthropic | openai | ollama | ...
    key_ciphertext  bytea not null,
    nonce           bytea not null,
    created_at      timestamptz not null default now(),
    unique (user_id, provider)
);
create index provider_keys_user_idx on provider_keys (user_id);

create table conversations (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    title       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index conversations_user_idx on conversations (user_id, updated_at desc);

create table messages (
    id               uuid primary key default gen_random_uuid(),
    conversation_id  uuid not null references conversations(id) on delete cascade,
    user_id          text not null references users(id) on delete cascade,
    role             text not null check (role in ('user', 'assistant', 'system')),
    content          text not null,
    model            text,
    confidence       int check (confidence between 0 and 100),
    created_at       timestamptz not null default now()
);
create index messages_conversation_idx on messages (conversation_id, created_at);
create index messages_user_idx on messages (user_id);

-- Chat branching: any chat message can branch into a Flow or Office run;
-- the branch carries conversation context as the task brief (plan §3).
create table branches (
    id           uuid primary key default gen_random_uuid(),
    chat_msg_id  uuid not null references messages(id) on delete cascade,
    user_id      text not null references users(id) on delete cascade,
    run_kind     text not null check (run_kind in ('flow', 'office')),
    run_id       uuid not null,
    created_at   timestamptz not null default now()
);
create index branches_user_idx on branches (user_id);

-- Flow runs: conductor/worker/inspector roles as data-driven definitions.
create table flow_runs (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    definition  jsonb not null,
    state       jsonb not null default '{}'::jsonb,
    status      text not null default 'pending'
                check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index flow_runs_user_idx on flow_runs (user_id, created_at desc);

-- Offices: scheduled flows with decomposition + STATE.md checkpointing.
create table offices (
    id             uuid primary key default gen_random_uuid(),
    user_id        text not null references users(id) on delete cascade,
    name           text not null,
    schedule_cron  text,
    definition     jsonb not null,
    enabled        boolean not null default true,
    created_at     timestamptz not null default now()
);
create index offices_user_idx on offices (user_id);

create table office_runs (
    id           uuid primary key default gen_random_uuid(),
    office_id    uuid not null references offices(id) on delete cascade,
    user_id      text not null references users(id) on delete cascade,
    state_md     text,                     -- STATE.md checkpoint contents
    status       text not null default 'pending'
                 check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
    started_at   timestamptz,
    finished_at  timestamptz
);
create index office_runs_user_idx on office_runs (user_id);
create index office_runs_office_idx on office_runs (office_id);

-- Memory vault: Postgres/pgvector FALLBACK store. cognee is the primary
-- memory engine (plan §0); rows here mirror what matters so memory
-- survives a cognee outage. scope: 'main' or a project sub-brain id.
create table memories (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    scope       text not null default 'main',
    content     text not null,
    tags        text[] not null default '{}',
    importance  real not null default 0.5 check (importance between 0 and 1),
    embedding   vector(768),
    created_at  timestamptz not null default now()
);
create index memories_user_scope_idx on memories (user_id, scope);

commit;
