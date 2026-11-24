-- Migration 143: Nullable audit for bot timer corrections.
alter table public.time_logs
  add column if not exists trimmed_from_seconds numeric check (trimmed_from_seconds > 0),
  add column if not exists trimmed_at timestamptz,
  add column if not exists trimmed_by uuid,
  add column if not exists trimmed_by_bot_key_id uuid check (trimmed_by_bot_key_id is null or trimmed_by is null),
  add column if not exists paused_trim_source jsonb check (jsonb_typeof(paused_trim_source) = 'object');

comment on column public.time_logs.trimmed_from_seconds is 'Running seconds before correction, for the whole timer.';
comment on column public.time_logs.trimmed_at is 'Time of the latest correction.';
comment on column public.time_logs.trimmed_by is 'User ID for the latest Timesheets correction.';
comment on column public.time_logs.trimmed_by_bot_key_id is 'Bot key ID for the latest correction at stop.';
comment on column public.time_logs.paused_trim_source is 'Original stretches, carry and pause instant for restoring time during the same pause.';
