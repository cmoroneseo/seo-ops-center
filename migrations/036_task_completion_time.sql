-- Migration 036: idempotent planner-time logging when a task is completed
--
-- The completion UI may retry after a network or task-status failure. A
-- dedicated operation ID keeps the planned-time entry single while preserving
-- the existing updateTask completion side effects (recurrence, activity,
-- deliverable nudges, and Basecamp to-do completion).

alter table public.time_logs
  add column if not exists completion_operation_id uuid;

create unique index if not exists time_logs_completion_operation_unique
  on public.time_logs (completion_operation_id)
  where completion_operation_id is not null;

create or replace function public.log_task_completion_time(
  p_task_id uuid,
  p_minutes integer,
  p_operation_id uuid,
  p_time_zone text,
  p_logged_at timestamptz
)
returns table (time_log_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  owned_task public.tasks%rowtype;
  existing_log_id uuid;
  new_log_id uuid;
  segment_start timestamptz;
  segment_end timestamptz;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_task_id is null or p_operation_id is null or p_logged_at is null then
    raise exception 'task, operation, and log timestamp are required'
      using errcode = '22004';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 1440 then
    raise exception 'completion time must be between 1 and 1440 minutes'
      using errcode = '22023';
  end if;
  if p_time_zone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names
    where pg_timezone_names.name = p_time_zone
  ) then
    raise exception 'invalid time zone' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('task-completion-time:' || p_operation_id::text, 0)
  );

  select time_logs.id
    into existing_log_id
    from public.time_logs
    where time_logs.completion_operation_id = p_operation_id
      and time_logs.user_id = actor_id;

  if found then
    return query select existing_log_id;
    return;
  end if;

  select tasks.*
    into owned_task
    from public.tasks
    where tasks.id = p_task_id
    for share;

  if not found or not exists (
    select 1
    from public.organization_members
    where organization_members.organization_id = owned_task.organization_id
      and organization_members.user_id = actor_id
  ) then
    raise exception 'task is outside the authenticated organization'
      using errcode = '42501';
  end if;

  if owned_task.status = 'done' then
    raise exception 'task is already complete' using errcode = '55000';
  end if;

  segment_start := coalesce(
    owned_task.start_date,
    p_logged_at - make_interval(mins => p_minutes)
  );
  segment_end := segment_start + make_interval(mins => p_minutes);

  insert into public.time_logs (
    organization_id,
    client_id,
    project_id,
    task_id,
    user_id,
    date,
    hours,
    description,
    billable,
    counts_toward_budget,
    status,
    timer_started_at,
    elapsed_seconds,
    category,
    planned_starts_at,
    planned_minutes,
    completion_operation_id,
    created_at
  ) values (
    owned_task.organization_id,
    owned_task.client_id,
    owned_task.project_id,
    owned_task.id,
    actor_id,
    (segment_start at time zone p_time_zone)::date,
    round((p_minutes::numeric / 60), 2),
    owned_task.title,
    owned_task.client_id is not null,
    owned_task.client_id is not null,
    'logged',
    null,
    p_minutes * 60,
    owned_task.category,
    owned_task.start_date,
    owned_task.scheduled_minutes,
    p_operation_id,
    p_logged_at
  )
  returning id into new_log_id;

  insert into public.time_log_segments (
    time_log_id,
    organization_id,
    user_id,
    started_at,
    ended_at
  ) values (
    new_log_id,
    owned_task.organization_id,
    actor_id,
    segment_start,
    segment_end
  );

  return query select new_log_id;
end;
$$;

revoke execute on function public.log_task_completion_time(uuid, integer, uuid, text, timestamptz)
  from public, anon;
grant execute on function public.log_task_completion_time(uuid, integer, uuid, text, timestamptz)
  to authenticated;
