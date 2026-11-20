-- Migration 137: Enforce one task per Basecamp recording.
--
-- To-do and step recording IDs are globally unique. Enforce the same
-- uniqueness on task links so concurrent links and imports cannot duplicate
-- a recording. This migration requires no duplicate non-null IDs:
-- select basecamp_todo_id from public.tasks where basecamp_todo_id is not null
-- group by basecamp_todo_id having count(*) > 1;

create unique index if not exists tasks_basecamp_recording_unique
    on public.tasks (basecamp_todo_id)
    where basecamp_todo_id is not null;
