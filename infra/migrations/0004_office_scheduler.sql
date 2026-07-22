-- 0004_office_scheduler.sql — G3 office scheduler bookkeeping (additive)
--
-- Additive only (0001/0002/0003 are never edited). The G3 cron ticker needs
-- durable, per-office bookkeeping so that "scheduled offices" fire exactly
-- once per due window and a brain restart mid-window never double-fires:
--
--   * next_fire_at  — the scheduled instant of the NEXT window to fire. It is
--     the compare-and-swap (CAS) anchor: a tick claims a due office by
--     advancing next_fire_at from the observed window to the following one in
--     a single conditional UPDATE (see repos/offices.claim_fire). Only the
--     first racing tick/replica whose WHERE still sees the old window wins the
--     claim; everyone else no-ops. This makes exactly-once firing durable
--     across ticks, restarts, and replicas even without Redis.
--   * last_fired_at — observability/audit: the window most recently fired.
--
-- Both are NULL for existing rows; the scheduler seeds next_fire_at on first
-- sight (to the next future occurrence, so history is never back-filled).
--
-- Tenant law: these columns live on the already tenant-owned `offices` table.
-- The scheduler's cross-tenant read (repos/offices.due_for_scheduling) returns
-- each row's OWNER user_id, and every subsequent write/run re-binds to that
-- owner (claim_fire / seed_next_fire / start_run all filter by user_id).
--
-- Applied by named command only (see infra/migrations/README.md).

begin;

alter table offices
    add column last_fired_at timestamptz,
    add column next_fire_at  timestamptz;

-- Partial index: the scheduler scans only enabled, scheduled offices whose
-- next window is due (or unseeded). Keeps the per-tick scan cheap.
create index offices_scheduling_idx
    on offices (next_fire_at)
    where enabled and schedule_cron is not null;

commit;
