-- Planner: a "Break" event kind.
--
-- A gap in a calendar has no vocabulary today, so an hour away from the desk
-- reads as unaccounted rather than as a break someone took. This gives the
-- honest answer a name, so the gap can be closed truthfully instead of being
-- papered over with a fake meeting.
--
-- Deliberately distinct from 'lunch': lunch is already in daily use here for a
-- specific block, and folding every short break into it would lose the
-- distinction rather than record it.
--
-- Never work: a break carries no client and produces no time log, so nothing
-- here touches billing or budget.

alter table planner_events
    drop constraint if exists planner_events_kind_check;

alter table planner_events
    add constraint planner_events_kind_check
    check (kind in ('meeting', 'focus', 'ooo', 'lunch', 'break', 'event'));
