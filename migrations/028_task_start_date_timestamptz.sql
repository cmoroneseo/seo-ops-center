-- =============================================================================
-- 027: tasks.start_date -> timestamptz
-- =============================================================================
-- The planner time-blocks tasks on an hour grid, so a task's start needs a time
-- of day. As a `date` column it silently truncated 9:15 AM to a bare date, and
-- reading "2026-07-30" back through `new Date(...)` parsed it as UTC midnight —
-- which renders as the previous evening in any negative-UTC-offset zone (PDT),
-- so a task dropped on Thursday reappeared on Wednesday.
--
-- Existing date values convert to midnight UTC. `tasks.start_date` is read only
-- by the planner (`lib/planner/items.ts`), so nothing else is affected.
-- `due_date` stays a date — it is a deadline, not a scheduled block.
-- =============================================================================

alter table public.tasks
  alter column start_date type timestamp with time zone
  using start_date::timestamp with time zone;
