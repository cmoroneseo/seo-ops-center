-- =============================================================================
-- 030: time_logs — internal work, budget exclusion, and planner linkage
-- =============================================================================
-- Three changes, all driven by how the planner is actually used:
--
-- 1. client_id becomes nullable. An internal 1:1 has no client, so it could not
--    be logged at all before this — the column was NOT NULL.
--
-- 2. counts_toward_budget separates "we tracked this" from "this eats the
--    client's SEO hours". A client meeting is tracked and may well be billable,
--    but it must not consume deliverable budget. `billable` is a different
--    question (can we invoice it) and is left alone.
--
-- 3. planner_event_id links a log back to the calendar block that produced it,
--    so an event can show whether its time has been recorded.
-- =============================================================================

alter table public.time_logs
  alter column client_id drop not null;

alter table public.time_logs
  add column if not exists counts_toward_budget boolean not null default true;

alter table public.time_logs
  add column if not exists planner_event_id uuid
    references public.planner_events(id) on delete set null;

-- "Has this event been logged yet?" — one row per event in practice.
create index if not exists time_logs_planner_event_idx
  on public.time_logs (planner_event_id)
  where planner_event_id is not null;

-- The budget rollup filters on this, so it pairs with the existing client/date
-- access pattern.
create index if not exists time_logs_budget_idx
  on public.time_logs (client_id, date)
  where counts_toward_budget = true;

-- Existing rows are all client work logged before meetings were trackable, so
-- the `true` default is already correct for them.
