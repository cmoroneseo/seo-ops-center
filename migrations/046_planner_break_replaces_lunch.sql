-- Planner: "Break" absorbs "lunch".
--
-- 'lunch' predates Break and named one specific interruption. Break covers the
-- same ground and more, and two kinds for "not working" is a distinction people
-- have to think about at the moment we least want them to hesitate — one click
-- to close a gap. Lunch survives perfectly well as a TITLE on a break.
--
-- Ordering is load-bearing: existing rows move to 'break' while the wider
-- constraint from migration 045 is still in force. Narrowing first would
-- reject its own data.

update planner_events set kind = 'break' where kind = 'lunch';

alter table planner_events
    drop constraint if exists planner_events_kind_check;

alter table planner_events
    add constraint planner_events_kind_check
    check (kind in ('meeting', 'focus', 'ooo', 'break', 'event'));
