-- =============================================================================
-- 028: tasks.scheduled_minutes — separate "time blocked" from "time estimated"
-- =============================================================================
-- The planner sized task blocks from estimated_hours and wrote back to it on
-- every drag and resize. Those are two different facts: estimated_hours is how
-- long the work takes, scheduled_minutes is how much of a given day you set
-- aside for it. Blocking one hour on Tuesday for a three-hour task must not
-- rewrite the estimate.
--
-- Null means "fall back to estimated_hours, then to one hour" — see
-- lib/planner/items.ts.
-- =============================================================================

alter table public.tasks
  add column if not exists scheduled_minutes integer;
