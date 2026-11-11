-- Migration 127: paused bot timers and a note on each stretch.
--
-- NOT APPLIED. Do not run this against the production Supabase project
-- (sgszojorcftyaknruckh). The owner reviews and applies it separately.
-- Not applied in this change.
--
-- Depends on migration 114 (time_logs_one_running_bot_timer) and migration 033
-- (time_log_segments). This file does not rewrite either of them.
--
-- Bot pause keeps the same time_logs row and sets status to 'paused'.
-- The running-timer index is `where status = 'in_progress' and bot_key_id is
-- not null`, so a paused row does not occupy that slot. A bot may have many
-- paused rows and one running row. Human timers stay 'in_progress' when a
-- person pauses them; this status is only written by the bot timer API.
--
-- A bot stretch is a closed time_log_segments row (ended_at set) with the
-- notes for that stretch in `note`. Bot timers still do not insert an open
-- segment, so one_open_time_segment_per_user is unchanged and still belongs
-- to the human timer.
--
-- No table is rewritten. No row is updated. The new check allows the existing
-- status values plus 'paused'.
--
-- Rollback: drop the note column, then restore the previous status check
-- (`in_progress`, `logged`, `needs_review`) once no row has status 'paused'.

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'time_logs'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%in_progress%'
    and pg_get_constraintdef(con.oid) ilike '%needs_review%'
    and pg_get_constraintdef(con.oid) not ilike '%import_status%';
  if constraint_name is not null then
    execute format('alter table public.time_logs drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.time_logs
  add constraint time_logs_status_check
  check (status in ('in_progress', 'paused', 'logged', 'needs_review'));

alter table public.time_log_segments
  add column if not exists note text;

comment on column public.time_log_segments.note is
  'Notes for this stretch, one per line, in the order they were sent. Null on human segments. Bot pause and resume write it. The Basecamp timesheet note is separate and is written only when the bot stops.';
