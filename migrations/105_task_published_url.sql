-- Migration 105: a task can carry the live URL of the page it shipped.
-- The ship date stays completed_at, which is already set when the task is done.
-- Tasks without a URL are unchanged.

alter table public.tasks
  add column if not exists published_url text;
