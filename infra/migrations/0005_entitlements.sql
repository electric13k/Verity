-- 0005_entitlements.sql — server-authoritative entitlements + usage metering
--
-- Additive only (0001..0004 are never edited). This is the anti-tamper spine
-- for plans/quotas: the browser bundle is always modifiable, so identity,
-- entitlements and usage live ONLY here, keyed to the JWT-verified user_id that
-- arrives as gateway-injected gRPC metadata. A client that edits its bundle to
-- claim a plan, a quota, or a usage figure changes nothing — every gated action
-- is re-decided server-side against these tables. Nothing the client controls
-- (request bodies, headers) is ever written here as identity.
--
-- Three tables:
--   * plans            — tier definitions (quotas as columns; NULL = unlimited).
--   * user_entitlements — user_id → plan_id + per-user overrides + status.
--   * usage_ledger      — append-only metered events; the authoritative charge.
--                         Idempotency key is UNIQUE, so a retried reservation is
--                         recorded once — no double-charge on replay.
--
-- This aligns with the M7 compute credits ledger (0002_compute_network.sql):
-- that ledger meters volunteer-node credits (append-only, balance = sum(delta));
-- usage_ledger meters per-user plan consumption the same way (append-only,
-- window usage = sum(amount)). Same discipline, different subject — not a fork.
--
-- Tenant law: every user-scoped table carries user_id; every read/write filters
-- on the gateway-injected tenant_ctx. No RLS is relied on as the boundary
-- (service-role connections bypass it); the filter IS the boundary.
--
-- Applied by named command only (see infra/migrations/README.md).

begin;

-- Plan / tier definitions. Quotas are per-UTC-day windows unless noted. A NULL
-- quota means "unlimited" for that metric. `features` holds boolean/scalar
-- capability flags the product surfaces (priority routing, etc.).
create table plans (
    id                       text primary key,          -- 'free' | 'pro' | 'max' | ...
    name                     text not null,
    messages_per_day         bigint,                    -- chat turns (chat/regen/edit)
    tokens_per_day           bigint,                    -- model tokens
    flows_per_day            bigint,                    -- flow runs
    offices_per_day          bigint,                    -- office runs
    uploads_per_day          bigint,                    -- file uploads
    compute_credits_per_day  bigint,                    -- compute-network spend cap
    house_calls_per_day      bigint,                    -- "provided by Verity" model calls (§5)
    max_offices              int,                        -- concurrent offices (structural cap)
    features                 jsonb not null default '{}'::jsonb,
    created_at               timestamptz not null default now()
);

-- Seed the built-in tiers. Free is the default every user lands on. Generous
-- enough for real dev/use; NULL columns on 'max' = unlimited.
insert into plans
    (id, name, messages_per_day, tokens_per_day, flows_per_day, offices_per_day,
     uploads_per_day, compute_credits_per_day, house_calls_per_day, max_offices, features)
values
    ('free', 'Free',  50,   100000,   5,   2,   10,   100,   20,   1,
        '{"priority": false}'::jsonb),
    ('pro',  'Pro',   2000, 5000000,  200, 100, 500,  10000, 1000, 20,
        '{"priority": true}'::jsonb),
    ('max',  'Max',   null, null,     null,null,null, null,  5000, 100,
        '{"priority": true, "unlimited": true}'::jsonb);

-- A user's entitlement: which plan, plus optional per-user overrides and a
-- lifecycle status. `overrides` is a JSONB map of metric-name → integer cap
-- (e.g. {"messages": 5000}) that supersedes the plan column for that metric
-- (null/absent = use the plan). status != 'active' denies all gated actions
-- (fail closed — a suspended account cannot spend).
create table user_entitlements (
    user_id     text primary key references users(id) on delete cascade,
    plan_id     text not null references plans(id),
    overrides   jsonb not null default '{}'::jsonb,
    status      text not null default 'active'
                check (status in ('active', 'suspended', 'canceled')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- Append-only metered-events ledger. Window usage for (user, metric) is
-- sum(amount) over the current window. The charge is recorded here, server-side,
-- BEFORE the gated action runs — this row is what a client can never forge.
--   * idempotency_key is UNIQUE: a retried reservation (same key) is a no-op
--     insert, so replays never double-charge and return the original decision.
--   * ref is an optional free-form pointer (request id, run id) for audit.
create table usage_ledger (
    id               uuid primary key default gen_random_uuid(),
    user_id          text not null references users(id) on delete cascade,
    metric           text not null,             -- messages | tokens | flows | offices | uploads | compute | house_calls
    amount           bigint not null default 1 check (amount >= 0),
    idempotency_key  text not null unique,      -- replay protection; globally unique
    ref              text,                       -- optional audit pointer (request/run id)
    created_at       timestamptz not null default now()
);
-- The hot path is "current-window usage for this user+metric": sum(amount)
-- filtered by user_id, metric, created_at >= window start.
create index usage_ledger_window_idx on usage_ledger (user_id, metric, created_at);

-- Default EVERY existing user to the free tier. New users are defaulted lazily
-- on first metered action (repos/entitlements.reserve upserts a free row), and
-- reads treat a missing row as 'free' too — so this backfill + the app-side
-- fallback both point at the same canonical free plan.
insert into user_entitlements (user_id, plan_id)
    select id, 'free' from users
    on conflict (user_id) do nothing;

commit;
