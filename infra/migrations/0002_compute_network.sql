-- 0002_compute_network.sql — scattered compute (M7, ported v1 schema)
--
-- Volunteer BOINC-style network: redundancy-2 + consensus only. No zk, no
-- training on volunteer hardware. Credits are an internal ledger, NOT
-- currency (legal §6). Sybil pair guard: the two assignments of a work
-- unit must go to nodes with different owners.

begin;

create table compute_nodes (
    id          uuid primary key default gen_random_uuid(),
    owner_id    text not null references users(id) on delete cascade,
    name        text not null,
    platform    text,                    -- os/arch reported by the daemon
    models      text[] not null default '{}',  -- GGUF models the node serves
    last_seen   timestamptz,
    enabled     boolean not null default true,
    created_at  timestamptz not null default now()
);
create index compute_nodes_owner_idx on compute_nodes (owner_id);

create table compute_jobs (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    kind        text not null default 'inference',
    model       text not null,
    -- temp-0 seed-7 inference: deterministic, so byte-equal outputs are
    -- the consensus criterion
    input_digest text not null,          -- sha256 of the prompt payload
    status      text not null default 'pending'
                check (status in ('pending', 'running', 'done', 'failed')),
    created_at  timestamptz not null default now()
);
create index compute_jobs_user_idx on compute_jobs (user_id);

create table work_units (
    id          uuid primary key default gen_random_uuid(),
    job_id      uuid not null references compute_jobs(id) on delete cascade,
    payload     jsonb not null,
    status      text not null default 'pending'
                check (status in ('pending', 'assigned', 'verified', 'conflicted', 'failed')),
    created_at  timestamptz not null default now()
);
create index work_units_job_idx on work_units (job_id);

-- Redundancy-2: exactly two assignments per unit; consensus = matching
-- result digests from two DIFFERENT owners.
create table assignments (
    id           uuid primary key default gen_random_uuid(),
    work_unit_id uuid not null references work_units(id) on delete cascade,
    node_id      uuid not null references compute_nodes(id) on delete cascade,
    result_digest text,
    assigned_at  timestamptz not null default now(),
    completed_at timestamptz,
    unique (work_unit_id, node_id)
);
create index assignments_unit_idx on assignments (work_unit_id);

-- Credits ledger: append-only; balance = sum(delta). Credits are internal
-- accounting only and are never redeemable for money.
create table credit_entries (
    id          uuid primary key default gen_random_uuid(),
    node_id     uuid not null references compute_nodes(id) on delete cascade,
    delta       bigint not null,
    reason      text not null,           -- verified_unit | conflict_penalty | ...
    work_unit_id uuid references work_units(id) on delete set null,
    created_at  timestamptz not null default now()
);
create index credit_entries_node_idx on credit_entries (node_id);

commit;
