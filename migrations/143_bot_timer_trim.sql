-- Migration 143: Bot timer trims and atomic writes of their stretches and day slices.
-- Adds nullable columns only. Existing timer rows need no backfill.
alter table public.time_logs
  add column if not exists trimmed_from_seconds numeric check (trimmed_from_seconds > 0),
  add column if not exists trimmed_at timestamptz,
  add column if not exists trimmed_by uuid,
  add column if not exists trimmed_by_bot_key_id uuid check (trimmed_by_bot_key_id is null or trimmed_by is null),
  add column if not exists trimmed_description text,
  add column if not exists paused_trim_source jsonb check (jsonb_typeof(paused_trim_source) = 'object');

comment on column public.time_logs.trimmed_from_seconds is
  'Original running seconds before correction, for the whole timer even when it spans several days.';
comment on column public.time_logs.trimmed_at is 'Time of the latest correction.';
comment on column public.time_logs.trimmed_by is 'User ID for the latest correction made in Timesheets.';
comment on column public.time_logs.trimmed_by_bot_key_id is 'Bot key ID for the latest correction made at stop.';
comment on column public.time_logs.trimmed_description is 'Description set in Timesheets, retained across bot resume.';
comment on column public.time_logs.paused_trim_source is
  'Restorable stretches, carry and pause instant from before the first edit of this pause. Cleared on resume or stop.';

-- Ordinary ledger updates use organization-wide RLS. Keep active bot time
-- and trim audit server-controlled even when accessed directly through PostgREST.
create or replace function public.protect_bot_timer_trim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if tg_table_name = 'time_logs' then
      if (old.bot_key_id is not null and old.status in ('in_progress', 'paused'))
         or (new.bot_key_id is not null and new.status in ('in_progress', 'paused'))
         or (new.trimmed_from_seconds, new.trimmed_at, new.trimmed_by, new.trimmed_by_bot_key_id,
             new.trimmed_description, new.paused_trim_source) is distinct from
            (old.trimmed_from_seconds, old.trimmed_at, old.trimmed_by, old.trimmed_by_bot_key_id,
             old.trimmed_description, old.paused_trim_source) then
        raise exception 'bot timer trims are server-controlled' using errcode = '42501';
      end if;
    elsif exists (
      select 1 from public.time_logs
      where id in (old.time_log_id, new.time_log_id)
        and bot_key_id is not null and status in ('in_progress', 'paused')
    ) then
      raise exception 'active bot timer stretches are server-controlled' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists protect_bot_timer_trim on public.time_logs;
create trigger protect_bot_timer_trim before insert or update on public.time_logs
  for each row execute function public.protect_bot_timer_trim();
drop trigger if exists protect_bot_timer_trim on public.time_log_segments;
create trigger protect_bot_timer_trim before insert or update or delete on public.time_log_segments
  for each row execute function public.protect_bot_timer_trim();

-- The service validates time, authorization and the transitions. Match its
-- snapshot under a row lock so a save cannot overwrite a concurrent edit,
-- pause, resume or stop. All segment and split-day writes share the transaction.
create or replace function public.write_bot_timer(
  p_id uuid, p_organization_id uuid, p_bot_key_id uuid, p_expected_status text,
  p_expected_started_at timestamptz, p_expected_elapsed_seconds integer,
  p_expected_trimmed_at timestamptz, p_patch jsonb, p_stretches jsonb, p_extra_days jsonb
) returns setof public.time_logs
language plpgsql
set search_path = ''
as $$
declare
  timer public.time_logs;
  next_timer public.time_logs;
begin
  select * into timer from public.time_logs
    where id = p_id and organization_id = p_organization_id and bot_key_id = p_bot_key_id
    for update;
  if not found then return; end if;

  -- Retry a stop whose database write succeeded before its response was saved.
  if timer.status in ('logged', 'needs_review')
     and timer.bot_operation_id = (p_patch->>'bot_operation_id')::uuid then
    return query select * from public.time_logs
      where organization_id = timer.organization_id and operation_id = timer.operation_id
      order by date, id;
    return;
  end if;

  if timer.status <> p_expected_status or timer.status not in ('in_progress', 'paused')
     or timer.timer_started_at is distinct from p_expected_started_at
     or timer.elapsed_seconds is distinct from p_expected_elapsed_seconds
     or timer.trimmed_at is distinct from p_expected_trimmed_at then return; end if;

  next_timer := jsonb_populate_record(timer, p_patch);
  update public.time_logs set
    status = next_timer.status, timer_started_at = next_timer.timer_started_at,
    date = next_timer.date, hours = next_timer.hours, elapsed_seconds = next_timer.elapsed_seconds,
    description = next_timer.description, billable = next_timer.billable,
    counts_toward_budget = next_timer.counts_toward_budget, session_notes = next_timer.session_notes,
    operation_id = next_timer.operation_id, bot_operation_id = next_timer.bot_operation_id,
    trimmed_from_seconds = next_timer.trimmed_from_seconds, trimmed_at = next_timer.trimmed_at,
    trimmed_by = next_timer.trimmed_by, trimmed_by_bot_key_id = next_timer.trimmed_by_bot_key_id,
    trimmed_description = next_timer.trimmed_description, paused_trim_source = next_timer.paused_trim_source
  where id = timer.id returning * into timer;

  delete from public.time_log_segments s where s.time_log_id = timer.id
    and not exists (select 1 from jsonb_to_recordset(p_stretches) as kept(started_at timestamptz)
                    where kept.started_at = s.started_at);
  update public.time_log_segments s set ended_at = kept.ended_at, note = kept.note
    from jsonb_to_recordset(p_stretches) as kept(started_at timestamptz, ended_at timestamptz, note text)
    where s.time_log_id = timer.id and s.started_at = kept.started_at
      and (s.ended_at, s.note) is distinct from (kept.ended_at, kept.note);
  insert into public.time_log_segments (id, time_log_id, organization_id, user_id, started_at, ended_at, note)
    select kept.id, timer.id, timer.organization_id, timer.user_id, kept.started_at, kept.ended_at, kept.note
    from jsonb_to_recordset(p_stretches) as kept(id uuid, started_at timestamptz, ended_at timestamptz, note text)
    where not exists (select 1 from public.time_log_segments s
                      where s.time_log_id = timer.id and s.started_at = kept.started_at);

  return next timer;
  return query insert into public.time_logs (
    organization_id, client_id, project_id, task_id, user_id, date, hours, description,
    billable, counts_toward_budget, status, elapsed_seconds, operation_id, source, bot_key_id,
    trimmed_from_seconds, trimmed_at, trimmed_by, trimmed_by_bot_key_id
  ) select
    timer.organization_id, timer.client_id, timer.project_id, timer.task_id, timer.user_id,
    day.date, day.hours, timer.description, timer.billable, timer.counts_toward_budget,
    timer.status, day.seconds, timer.operation_id, 'seo_pm', timer.bot_key_id,
    timer.trimmed_from_seconds, timer.trimmed_at, timer.trimmed_by, timer.trimmed_by_bot_key_id
    from jsonb_to_recordset(p_extra_days) as day(date date, seconds integer, hours numeric)
    returning *;
end;
$$;

revoke execute on function public.write_bot_timer(uuid, uuid, uuid, text, timestamptz, integer, timestamptz, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.write_bot_timer(uuid, uuid, uuid, text, timestamptz, integer, timestamptz, jsonb, jsonb, jsonb)
  to service_role;
