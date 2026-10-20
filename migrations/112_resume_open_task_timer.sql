-- Migration 112: one open attempt per user and task, dated in the user's zone.
--
-- start_task_timer only took a per-user advisory lock and then inserted.
-- A second Start, or switch_time_attempt(from, to_task=same task), paused the
-- running row and inserted another in_progress row. The paused one stayed
-- forever. Start on a task that already has this user's open attempt now
-- resumes that attempt. Start on the attempt that is already running is a
-- no-op. Both decisions happen here, under the same advisory lock the timer
-- RPCs already take, so a client that skips the UI cannot create the duplicate.
--
-- The open row's date used (started_at AT TIME ZONE 'UTC')::date, so evening
-- work in a negative offset was stored as the next day until finalize rewrote
-- it. Finalize already takes p_time_zone. Start, switch, and planner session
-- start now take the same argument and store that zone's calendar date.
-- Callers that still use the previous signatures keep working: those wrappers
-- pass a null zone, which means UTC, and they still reuse an open attempt.
--
-- p_reuse_open is not a client parameter. It exists only on
-- start_task_timer_attempt, which authenticated cannot execute. Planner focus
-- blocks are one log per event, so start_planner_task_session calls that
-- internal function with reuse disabled. A public flag would let a direct RPC
-- recreate the duplicate.
--
-- A brand-new attempt still copies tasks.start_date and tasks.scheduled_minutes
-- onto the log and then nulls them on the task. That clear is unchanged.
-- Resuming an existing attempt does not take a new snapshot and does not clear
-- the task. The already-running no-op does not write the task either.
--
-- Locks: CREATE OR REPLACE / CREATE FUNCTION lock only the new pg_proc rows.
-- No table is rewritten and no row is updated by this file. Inside a call,
-- the task row lock and the per-user advisory lock are the ones migration 033
-- already takes. Pause, resume, stop review, and finalize now take that advisory lock
-- before their time_logs row lock. Reuse locks the open row only after the
-- same advisory lock, so the two orders cannot deadlock.
--
-- Existing data: duplicate paused rows are left in place. A unique index on
-- open attempts would fail to build while those rows exist, and deleting them
-- from a migration would discard real tracked time. Stop on the paused row
-- still opens the review sheet, and Discard there deletes that in_progress row.
--
-- Rollback: in one transaction, CREATE OR REPLACE the previous bodies of
-- start_task_timer(uuid, timestamptz) from migration 110,
-- pause_time_attempt, resume_time_attempt, begin_stop_review,
-- finalize_time_attempt, and
-- switch_time_attempt(uuid, uuid, uuid, timestamptz) from migration 033, and
-- start_planner_task_session(uuid, uuid, timestamptz, uuid) from migration 068,
-- then DROP the overloads and start_task_timer_attempt added below. Do not
-- drop the previous signatures; in-flight clients still call them.

-- Pause, resume, stop review, and finalize take the per-user lock before
-- the row lock. CREATE OR REPLACE keeps the grants from migration 033.

create or replace function public.pause_time_attempt(
  p_time_log_id uuid,
  p_paused_at timestamptz
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  attempt public.time_logs%rowtype;
  open_segment public.time_log_segments%rowtype;
  latest_ended_at timestamptz;
  v_organization_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_paused_at is null then
    raise exception 'pause timestamp is required' using errcode = '22004';
  end if;

  -- Advisory lock before the row lock. start_task_timer_attempt holds this
  -- same lock and then locks the open time_logs row. The opposite order
  -- deadlocks when both run for one user.
  select time_logs.organization_id
    into v_organization_id
    from public.time_logs
    where time_logs.id = p_time_log_id
      and time_logs.user_id = actor_id;

  if v_organization_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_organization_id::text || ':' || actor_id::text, 0)
    );
  end if;

  select time_logs.*
    into attempt
    from public.time_logs
    where time_logs.id = p_time_log_id
      and time_logs.user_id = actor_id
      and time_logs.status = 'in_progress'
      and exists (
        select 1
        from public.organization_members
        where organization_members.organization_id = time_logs.organization_id
          and organization_members.user_id = actor_id
      )
    for update;

  if not found then
    raise exception 'owned in-progress time attempt not found'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(attempt.organization_id::text || ':' || actor_id::text, 0)
  );

  select time_log_segments.*
    into open_segment
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id
      and time_log_segments.ended_at is null
    for update;

  if not found then
    select max(time_log_segments.ended_at)
      into latest_ended_at
      from public.time_log_segments
      where time_log_segments.time_log_id = attempt.id;

    if attempt.reviewing_at is null
       and attempt.timer_started_at is null
       and latest_ended_at is not null
       and latest_ended_at is not distinct from p_paused_at then
      return next attempt;
      return;
    end if;

    raise exception 'time attempt is not running or pause retry conflicts'
      using errcode = '55000';
  end if;
  if p_paused_at <= open_segment.started_at then
    raise exception 'pause timestamp must be after segment start'
      using errcode = '22007';
  end if;

  update public.time_log_segments
    set ended_at = p_paused_at
    where time_log_segments.id = open_segment.id;

  update public.time_logs
    set timer_started_at = null
    where time_logs.id = attempt.id
    returning * into attempt;

  return next attempt;
end;
$$;

create or replace function public.resume_time_attempt(
  p_time_log_id uuid,
  p_resumed_at timestamptz
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  attempt public.time_logs%rowtype;
  latest_ended_at timestamptz;
  open_segment public.time_log_segments%rowtype;
  v_organization_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_resumed_at is null then
    raise exception 'resume timestamp is required' using errcode = '22004';
  end if;

  -- Advisory lock before the row lock. start_task_timer_attempt holds this
  -- same lock and then locks the open time_logs row. The opposite order
  -- deadlocks when both run for one user.
  select time_logs.organization_id
    into v_organization_id
    from public.time_logs
    where time_logs.id = p_time_log_id
      and time_logs.user_id = actor_id;

  if v_organization_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_organization_id::text || ':' || actor_id::text, 0)
    );
  end if;

  select time_logs.*
    into attempt
    from public.time_logs
    where time_logs.id = p_time_log_id
      and time_logs.user_id = actor_id
      and time_logs.status = 'in_progress'
      and exists (
        select 1
        from public.organization_members
        where organization_members.organization_id = time_logs.organization_id
          and organization_members.user_id = actor_id
      )
    for update;

  if not found then
    raise exception 'owned in-progress time attempt not found'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(attempt.organization_id::text || ':' || actor_id::text, 0)
  );

  select time_log_segments.*
    into open_segment
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id
      and time_log_segments.ended_at is null
    for update;

  if found then
    if open_segment.started_at is not distinct from p_resumed_at
       and attempt.timer_started_at is not distinct from p_resumed_at
       and attempt.reviewing_at is null
       and not exists (
         select 1
         from public.time_log_segments
         where time_log_segments.time_log_id = attempt.id
           and time_log_segments.ended_at > p_resumed_at
       ) then
      return next attempt;
      return;
    end if;

    raise exception 'time attempt is already running with conflicting state'
      using errcode = '55000';
  end if;

  select max(time_log_segments.ended_at)
    into latest_ended_at
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id;

  if latest_ended_at is not null and p_resumed_at < latest_ended_at then
    raise exception 'resume timestamp precedes the latest segment end'
      using errcode = '22007';
  end if;

  insert into public.time_log_segments (
    time_log_id,
    organization_id,
    user_id,
    started_at
  ) values (
    attempt.id,
    attempt.organization_id,
    actor_id,
    p_resumed_at
  );

  update public.time_logs
    set timer_started_at = p_resumed_at,
        reviewing_at = null
    where time_logs.id = attempt.id
    returning * into attempt;

  return next attempt;
end;
$$;

create or replace function public.begin_stop_review(
  p_time_log_id uuid,
  p_reviewing_at timestamptz
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  attempt public.time_logs%rowtype;
  open_segment public.time_log_segments%rowtype;
  latest_ended_at timestamptz;
  v_organization_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_reviewing_at is null then
    raise exception 'review timestamp is required' using errcode = '22004';
  end if;

  -- Advisory lock before the row lock. start_task_timer_attempt holds this
  -- same lock and then locks the open time_logs row. The opposite order
  -- deadlocks when both run for one user.
  select time_logs.organization_id
    into v_organization_id
    from public.time_logs
    where time_logs.id = p_time_log_id
      and time_logs.user_id = actor_id;

  if v_organization_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_organization_id::text || ':' || actor_id::text, 0)
    );
  end if;

  select time_logs.*
    into attempt
    from public.time_logs
    where time_logs.id = p_time_log_id
      and time_logs.user_id = actor_id
      and time_logs.status = 'in_progress'
      and exists (
        select 1
        from public.organization_members
        where organization_members.organization_id = time_logs.organization_id
          and organization_members.user_id = actor_id
      )
    for update;

  if not found then
    raise exception 'owned in-progress time attempt not found'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(attempt.organization_id::text || ':' || actor_id::text, 0)
  );

  select time_log_segments.*
    into open_segment
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id
      and time_log_segments.ended_at is null
    for update;

  if found then
    if p_reviewing_at <= open_segment.started_at then
      raise exception 'review timestamp must be after segment start'
        using errcode = '22007';
    end if;
    update public.time_log_segments
      set ended_at = p_reviewing_at
      where time_log_segments.id = open_segment.id;
  end if;

  select max(time_log_segments.ended_at)
    into latest_ended_at
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id;

  if latest_ended_at is not null and p_reviewing_at < latest_ended_at then
    raise exception 'review timestamp precedes the latest segment end'
      using errcode = '22007';
  end if;

  update public.time_logs
    set timer_started_at = null,
        reviewing_at = p_reviewing_at
    where time_logs.id = attempt.id
    returning * into attempt;

  return next attempt;
end;
$$;

create or replace function public.finalize_time_attempt(
  p_time_log_id uuid,
  p_description text,
  p_billable boolean,
  p_counts_toward_budget boolean,
  p_time_zone text,
  p_operation_id uuid,
  p_finalized_at timestamptz
)
returns table (
  time_log_id uuid,
  task_id uuid,
  client_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  attempt public.time_logs%rowtype;
  trusted_task public.tasks%rowtype;
  trusted_project public.projects%rowtype;
  trusted_client_id uuid;
  segment public.time_log_segments%rowtype;
  day_entry record;
  cursor_at timestamptz;
  slice_end timestamptz;
  next_midnight timestamptz;
  slice_date date;
  first_date date;
  seconds_by_date jsonb := '{}'::jsonb;
  log_ids_by_date jsonb := '{}'::jsonb;
  daily_log_id uuid;
  first_piece boolean;
  latest_ended_at timestamptz;
  v_organization_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_time_zone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names
    where pg_timezone_names.name = p_time_zone
  ) then
    raise exception 'invalid time zone' using errcode = '22023';
  end if;
  if p_operation_id is null or p_finalized_at is null then
    raise exception 'operation and finalization timestamps are required'
      using errcode = '22004';
  end if;
  if p_billable is null or p_counts_toward_budget is null then
    raise exception 'billable and budget decisions are required'
      using errcode = '22004';
  end if;

  -- Advisory lock before the row lock. start_task_timer_attempt holds this
  -- same lock and then locks the open time_logs row. The opposite order
  -- deadlocks when both run for one user.
  select time_logs.organization_id
    into v_organization_id
    from public.time_logs
    where time_logs.id = p_time_log_id
      and time_logs.user_id = actor_id;

  if v_organization_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_organization_id::text || ':' || actor_id::text, 0)
    );
  end if;

  select time_logs.*
    into attempt
    from public.time_logs
    where time_logs.id = p_time_log_id
      and time_logs.user_id = actor_id
      and exists (
        select 1
        from public.organization_members
        where organization_members.organization_id = time_logs.organization_id
          and organization_members.user_id = actor_id
      )
    for update;

  if not found then
    raise exception 'owned time attempt not found' using errcode = '42501';
  end if;

  if attempt.project_id is not null then
    select projects.*
      into trusted_project
      from public.projects
      where projects.id = attempt.project_id
        and projects.organization_id = attempt.organization_id
      for share;

    if not found then
      raise exception 'time attempt project is outside its organization'
        using errcode = '23514';
    end if;
    trusted_client_id := trusted_project.client_id;
  else
    trusted_client_id := attempt.client_id;
  end if;

  if attempt.task_id is not null then
    select tasks.*
      into trusted_task
      from public.tasks
      where tasks.id = attempt.task_id
        and tasks.organization_id = attempt.organization_id
      for share;

    if not found or trusted_task.project_id is distinct from attempt.project_id then
      raise exception 'time attempt task is outside its trusted project'
        using errcode = '23514';
    end if;
    if trusted_task.client_id is not null
       and trusted_task.client_id is distinct from trusted_client_id then
      raise exception 'time attempt task client differs from its project client'
        using errcode = '23514';
    end if;
    trusted_client_id := coalesce(trusted_task.client_id, trusted_client_id);
  end if;

  if attempt.client_id is distinct from trusted_client_id then
    raise exception 'time attempt client differs from its trusted task or project'
      using errcode = '23514';
  end if;
  if trusted_client_id is not null and not exists (
    select 1
    from public.clients
    where clients.id = trusted_client_id
      and clients.organization_id = attempt.organization_id
  ) then
    raise exception 'time attempt client is outside its organization'
      using errcode = '23514';
  end if;

  if attempt.status = 'logged' and attempt.operation_id = p_operation_id then
    return query
      select time_logs.id, time_logs.task_id, time_logs.client_id
      from public.time_logs
      where time_logs.operation_id = p_operation_id
        and time_logs.user_id = actor_id
        and time_logs.organization_id = attempt.organization_id
        and time_logs.task_id is not distinct from attempt.task_id
        and time_logs.client_id is not distinct from attempt.client_id
      order by time_logs.date, time_logs.id;
    return;
  end if;

  if attempt.status <> 'in_progress' then
    raise exception 'time attempt is not finalizable' using errcode = '55000';
  end if;
  if attempt.reviewing_at is null or p_finalized_at < attempt.reviewing_at then
    raise exception 'time attempt must enter review before finalization'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id
      and time_log_segments.ended_at is null
  ) then
    raise exception 'time attempt must enter review before finalization'
      using errcode = '55000';
  end if;

  select max(time_log_segments.ended_at)
    into latest_ended_at
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id;

  if latest_ended_at is not null and (
    attempt.reviewing_at < latest_ended_at
    or p_finalized_at < latest_ended_at
  ) then
    raise exception 'review or finalization timestamp precedes tracked work'
      using errcode = '22007';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('timer-operation:' || p_operation_id::text, 0)
  );

  if exists (
    select 1
    from public.time_logs
    where time_logs.operation_id = p_operation_id
      and time_logs.id <> attempt.id
  ) then
    raise exception 'operation identifier is already in use'
      using errcode = '23505';
  end if;

  for segment in
    select time_log_segments.*
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id
    order by time_log_segments.started_at, time_log_segments.id
    for update
  loop
    cursor_at := segment.started_at;
    while cursor_at < segment.ended_at loop
      slice_date := (cursor_at at time zone p_time_zone)::date;
      next_midnight := ((slice_date + 1)::timestamp at time zone p_time_zone);
      slice_end := least(segment.ended_at, next_midnight);
      seconds_by_date := jsonb_set(
        seconds_by_date,
        array[slice_date::text],
        to_jsonb(
          coalesce((seconds_by_date ->> slice_date::text)::numeric, 0)
          + extract(epoch from (slice_end - cursor_at))
        ),
        true
      );
      first_date := least(coalesce(first_date, slice_date), slice_date);
      cursor_at := slice_end;
    end loop;
  end loop;

  -- elapsed_seconds remains the baseline for pre-033 timer history. New segment
  -- duration is added to it without inventing a historical segment.
  if attempt.elapsed_seconds > 0 then
    first_date := least(coalesce(first_date, attempt.date), attempt.date);
    seconds_by_date := jsonb_set(
      seconds_by_date,
      array[attempt.date::text],
      to_jsonb(
        coalesce((seconds_by_date ->> attempt.date::text)::numeric, 0)
        + attempt.elapsed_seconds
      ),
      true
    );
  end if;

  if first_date is null then
    raise exception 'time attempt has no tracked duration' using errcode = '22000';
  end if;

  update public.time_logs
    set date = first_date,
        hours = round(((seconds_by_date ->> first_date::text)::numeric / 3600), 2),
        description = p_description,
        billable = p_billable,
        counts_toward_budget = p_counts_toward_budget,
        status = 'logged',
        timer_started_at = null,
        elapsed_seconds = round((seconds_by_date ->> first_date::text)::numeric)::integer,
        reviewing_at = null,
        operation_id = p_operation_id
    where time_logs.id = attempt.id;

  log_ids_by_date := jsonb_build_object(first_date::text, attempt.id::text);

  for day_entry in
    select daily.key as local_date, daily.value as active_seconds
    from jsonb_each_text(seconds_by_date) as daily
    where daily.key <> first_date::text
    order by daily.key
  loop
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
      session_notes,
      basecamp_project_id,
      planned_starts_at,
      planned_minutes,
      reviewing_at,
      operation_id,
      created_at
    ) values (
      attempt.organization_id,
      attempt.client_id,
      attempt.project_id,
      attempt.task_id,
      actor_id,
      day_entry.local_date::date,
      round((day_entry.active_seconds::numeric / 3600), 2),
      p_description,
      p_billable,
      p_counts_toward_budget,
      'logged',
      null,
      round(day_entry.active_seconds::numeric)::integer,
      attempt.category,
      attempt.session_notes,
      attempt.basecamp_project_id,
      attempt.planned_starts_at,
      attempt.planned_minutes,
      null,
      p_operation_id,
      p_finalized_at
    )
    returning id into daily_log_id;

    log_ids_by_date := jsonb_set(
      log_ids_by_date,
      array[day_entry.local_date],
      to_jsonb(daily_log_id::text),
      true
    );
  end loop;

  -- Re-parent every segment to its daily log and physically split a segment at
  -- each local-midnight boundary. The first piece retains the original ID.
  for segment in
    select time_log_segments.*
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id
    order by time_log_segments.started_at, time_log_segments.id
  loop
    cursor_at := segment.started_at;
    first_piece := true;
    while cursor_at < segment.ended_at loop
      slice_date := (cursor_at at time zone p_time_zone)::date;
      next_midnight := ((slice_date + 1)::timestamp at time zone p_time_zone);
      slice_end := least(segment.ended_at, next_midnight);
      daily_log_id := (log_ids_by_date ->> slice_date::text)::uuid;

      if first_piece then
        update public.time_log_segments
          set time_log_id = daily_log_id,
              started_at = cursor_at,
              ended_at = slice_end
          where time_log_segments.id = segment.id;
        first_piece := false;
      else
        insert into public.time_log_segments (
          time_log_id,
          organization_id,
          user_id,
          started_at,
          ended_at,
          created_at
        ) values (
          daily_log_id,
          segment.organization_id,
          segment.user_id,
          cursor_at,
          slice_end,
          segment.created_at
        );
      end if;

      cursor_at := slice_end;
    end loop;
  end loop;

  return query
    select time_logs.id, time_logs.task_id, time_logs.client_id
    from public.time_logs
    where time_logs.id in (
      select mapping.value::uuid
      from jsonb_each_text(log_ids_by_date) as mapping
    )
    order by time_logs.date, time_logs.id;
end;
$$;

create or replace function public.start_task_timer_attempt(
  p_task_id uuid,
  p_started_at timestamptz,
  p_time_zone text,
  p_reuse_open boolean
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  owned_task public.tasks%rowtype;
  trusted_project public.projects%rowtype;
  trusted_client_id uuid;
  attempt public.time_logs%rowtype;
  existing public.time_logs%rowtype;
  v_time_zone text := coalesce(nullif(p_time_zone, ''), 'UTC');
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_started_at is null then
    raise exception 'timer start timestamp is required' using errcode = '22004';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where pg_timezone_names.name = v_time_zone
  ) then
    raise exception 'invalid time zone' using errcode = '22023';
  end if;

  select tasks.*
    into owned_task
    from public.tasks
    where tasks.id = public.resolve_time_tracking_task_id(p_task_id)
    for update;

  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.organization_members
    where organization_members.organization_id = owned_task.organization_id
      and organization_members.user_id = actor_id
  ) then
    raise exception 'task is outside the authenticated organization'
      using errcode = '42501';
  end if;

  -- Assignment is the task-level ownership boundary. A row lock makes claiming
  -- an entirely unassigned task atomic; otherwise the actor must already be one
  -- of its legacy or multi-assignees.
  if owned_task.assignee_id is null
     and cardinality(owned_task.assignee_ids) = 0 then
    update public.tasks
      set assignee_id = actor_id,
          assignee_ids = array[actor_id]
      where tasks.id = owned_task.id
      returning * into owned_task;
  elsif not (
    owned_task.assignee_id = actor_id
    or actor_id = any(owned_task.assignee_ids)
  ) then
    raise exception 'task is assigned to another user'
      using errcode = '42501';
  end if;

  -- tasks.project_id is nullable (migration 014): tasks are created from the
  -- client page with no project. Only validate a project the task actually has,
  -- matching how finalize_time_attempt resolves its trusted client.
  if owned_task.project_id is not null then
    select projects.*
      into trusted_project
      from public.projects
      where projects.id = owned_task.project_id
        and projects.organization_id = owned_task.organization_id;

    if not found then
      raise exception 'task project is outside the task organization'
        using errcode = '23514';
    end if;
    if owned_task.client_id is not null
       and owned_task.client_id is distinct from trusted_project.client_id then
      raise exception 'task client differs from its project client'
        using errcode = '23514';
    end if;

    trusted_client_id := coalesce(owned_task.client_id, trusted_project.client_id);
  else
    trusted_client_id := owned_task.client_id;
  end if;
  if trusted_client_id is not null and not exists (
    select 1
    from public.clients
    where clients.id = trusted_client_id
      and clients.organization_id = owned_task.organization_id
  ) then
    raise exception 'task client is outside the task organization'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(owned_task.organization_id::text || ':' || actor_id::text, 0)
  );

  -- Reuse is the task-timer rule. Planner sessions pass false so each focus
  -- block keeps its own log. The flag is not granted to authenticated.
  if coalesce(p_reuse_open, true) then
    select time_logs.*
      into existing
      from public.time_logs
      where time_logs.organization_id = owned_task.organization_id
        and time_logs.user_id = actor_id
        and time_logs.task_id = owned_task.id
        and time_logs.status = 'in_progress'
        and time_logs.reviewing_at is null
      order by
        (time_logs.timer_started_at is not null) desc,
        (
          select max(time_log_segments.ended_at)
          from public.time_log_segments
          where time_log_segments.time_log_id = time_logs.id
        ) desc nulls last,
        time_logs.created_at desc,
        time_logs.id desc
      limit 1
      for update;

    if found and existing.timer_started_at is not null then
      return next existing;
      return;
    end if;

    if found then
      select resumed.*
        into attempt
        from public.resume_time_attempt(existing.id, p_started_at) as resumed
        limit 1;
      return next attempt;
      return;
    end if;

    if exists (
      select 1
      from public.time_logs
      where time_logs.organization_id = owned_task.organization_id
        and time_logs.user_id = actor_id
        and time_logs.task_id = owned_task.id
        and time_logs.status = 'in_progress'
        and time_logs.reviewing_at is not null
    ) then
      raise exception 'time attempt is in review' using errcode = '55000';
    end if;
  end if;

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
    planned_minutes
  ) values (
    owned_task.organization_id,
    trusted_client_id,
    trusted_project.id,
    owned_task.id,
    actor_id,
    (p_started_at at time zone v_time_zone)::date,
    0,
    owned_task.title,
    true,
    trusted_client_id is not null,
    'in_progress',
    p_started_at,
    0,
    owned_task.category,
    owned_task.start_date,
    owned_task.scheduled_minutes
  )
  returning * into attempt;

  -- New attempts still snapshot the forecast and clear it. Resume and the
  -- already-running no-op return above and do not run this update.
  update public.tasks
    set start_date = null,
        scheduled_minutes = null
    where tasks.id = owned_task.id;

  -- A to-do task moves to in progress when its timer starts. Done stays done.
  perform public.note_timer_started_on_task(owned_task.id, p_started_at, actor_id);

  insert into public.time_log_segments (
    time_log_id,
    organization_id,
    user_id,
    started_at
  ) values (
    attempt.id,
    attempt.organization_id,
    actor_id,
    p_started_at
  );

  return next attempt;
end;
$$;

revoke all on function public.start_task_timer_attempt(uuid, timestamptz, text, boolean) from public, anon, authenticated;

-- New signature. No default on p_time_zone, so a 2-arg call stays on the
-- previous function and PostgREST can tell the overloads apart.
create or replace function public.start_task_timer(
  p_task_id uuid,
  p_started_at timestamptz,
  p_time_zone text
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select *
    from public.start_task_timer_attempt(p_task_id, p_started_at, p_time_zone, true);
end;
$$;

revoke execute on function public.start_task_timer(uuid, timestamptz, text) from public, anon;
grant execute on function public.start_task_timer(uuid, timestamptz, text) to authenticated;

-- Previous signature. Same reuse rule, UTC date when the caller has no zone.
create or replace function public.start_task_timer(
  p_task_id uuid,
  p_started_at timestamptz
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select *
    from public.start_task_timer_attempt(p_task_id, p_started_at, null, true);
end;
$$;

revoke execute on function public.start_task_timer(uuid, timestamptz) from public, anon;
grant execute on function public.start_task_timer(uuid, timestamptz) to authenticated;

create or replace function public.switch_time_attempt(
  p_from_time_log_id uuid,
  p_to_time_log_id uuid,
  p_to_task_id uuid,
  p_switched_at timestamptz,
  p_time_zone text
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  paused_attempt public.time_logs%rowtype;
  active_attempt public.time_logs%rowtype;
  source_attempt public.time_logs%rowtype;
  source_organization_id uuid;
  target_task public.tasks%rowtype;
  target_segment public.time_log_segments%rowtype;
  resolved_task_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_switched_at is null then
    raise exception 'switch timestamp is required' using errcode = '22004';
  end if;
  if (p_to_time_log_id is null) = (p_to_task_id is null) then
    raise exception 'switch requires exactly one target attempt or target task'
      using errcode = '22023';
  end if;
  if p_to_time_log_id is not null and p_to_time_log_id = p_from_time_log_id then
    raise exception 'switch target must differ from running attempt'
      using errcode = '22023';
  end if;

  -- Switching to the task that is already running must not pause it. A child
  -- row resolves to the same pillar the open log is stored on.
  if p_to_task_id is not null then
    resolved_task_id := public.resolve_time_tracking_task_id(p_to_task_id);

    select time_logs.organization_id
      into source_organization_id
      from public.time_logs
      where time_logs.id = p_from_time_log_id
        and time_logs.user_id = actor_id
        and time_logs.status = 'in_progress'
        and time_logs.timer_started_at is not null
        and time_logs.reviewing_at is null
        and time_logs.task_id is not distinct from resolved_task_id
        and exists (
          select 1
          from public.organization_members
          where organization_members.organization_id = time_logs.organization_id
            and organization_members.user_id = actor_id
        );

    if found then
      perform pg_advisory_xact_lock(
        hashtextextended(source_organization_id::text || ':' || actor_id::text, 0)
      );

      select time_logs.*
        into source_attempt
        from public.time_logs
        where time_logs.id = p_from_time_log_id
          and time_logs.user_id = actor_id
          and time_logs.status = 'in_progress'
          and time_logs.timer_started_at is not null
          and time_logs.reviewing_at is null
          and time_logs.task_id is not distinct from resolved_task_id
        for update;

      if found then
        return next source_attempt;
        return;
      end if;
    end if;
  end if;

  select paused.*
    into paused_attempt
    from public.pause_time_attempt(p_from_time_log_id, p_switched_at) as paused
    limit 1;

  if p_to_time_log_id is not null then
    select resumed.*
      into active_attempt
      from public.resume_time_attempt(p_to_time_log_id, p_switched_at) as resumed
      limit 1;
  else
    resolved_task_id := public.resolve_time_tracking_task_id(p_to_task_id);

    select time_logs.*
      into active_attempt
      from public.time_logs
      where time_logs.task_id = resolved_task_id
        and time_logs.user_id = actor_id
        and exists (
          select 1
          from public.time_log_segments
          where time_log_segments.time_log_id = time_logs.id
            and time_log_segments.started_at = p_switched_at
        )
      order by time_logs.created_at desc, time_logs.id
      limit 1
      for update of time_logs;

    if found then
      perform pg_advisory_xact_lock(
        hashtextextended(active_attempt.organization_id::text || ':' || actor_id::text, 0)
      );

      perform 1
        from public.organization_members
        where organization_members.organization_id = active_attempt.organization_id
          and organization_members.user_id = actor_id
        for key share;

      if not found then
        raise exception 'actor is no longer a member of the switch target organization'
          using errcode = '42501';
      end if;

      select tasks.*
        into target_task
        from public.tasks
        where tasks.id = resolved_task_id
          and tasks.organization_id = active_attempt.organization_id
        for share;

      if not found or not (
        target_task.assignee_id = actor_id
        or actor_id = any(target_task.assignee_ids)
      ) then
        raise exception 'actor no longer owns the switch target task'
          using errcode = '42501';
      end if;

      select time_log_segments.*
        into target_segment
        from public.time_log_segments
        where time_log_segments.time_log_id = active_attempt.id
          and time_log_segments.started_at = p_switched_at
        order by time_log_segments.id
        limit 1
        for update;

      if not found then
        raise exception 'switch retry target segment no longer exists'
          using errcode = '55000';
      end if;

      if active_attempt.status = 'in_progress'
         and active_attempt.reviewing_at is null
         and active_attempt.timer_started_at is not distinct from p_switched_at
         and target_segment.ended_at is null
         and not exists (
           select 1
           from public.time_log_segments
           where time_log_segments.time_log_id = active_attempt.id
             and time_log_segments.ended_at > p_switched_at
         ) then
        null; -- Exact switch retry: return the already-active canonical row.
      else
        raise exception 'switch retry conflicts with advanced target state'
          using errcode = '55000';
      end if;
    else
      select started.*
        into active_attempt
        from public.start_task_timer(p_to_task_id, p_switched_at, p_time_zone) as started
        limit 1;
    end if;
  end if;

  return next paused_attempt;
  return next active_attempt;
end;
$$;

revoke execute on function public.switch_time_attempt(uuid, uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.switch_time_attempt(uuid, uuid, uuid, timestamptz, text) to authenticated;

create or replace function public.switch_time_attempt(
  p_from_time_log_id uuid,
  p_to_time_log_id uuid,
  p_to_task_id uuid,
  p_switched_at timestamptz
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select *
    from public.switch_time_attempt(
      p_from_time_log_id,
      p_to_time_log_id,
      p_to_task_id,
      p_switched_at,
      null::text
    );
end;
$$;

revoke execute on function public.switch_time_attempt(uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.switch_time_attempt(uuid, uuid, uuid, timestamptz) to authenticated;

create or replace function public.start_planner_task_session(
  p_task_id uuid,
  p_event_id uuid,
  p_started_at timestamptz,
  p_from_time_log_id uuid,
  p_time_zone text
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  owned_task public.tasks%rowtype;
  session_event public.planner_events%rowtype;
  attempt public.time_logs%rowtype;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into owned_task from public.tasks where id = p_task_id for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id = owned_task.organization_id and user_id = actor_id
  ) then
    raise exception 'task is outside the authenticated organization' using errcode = '42501';
  end if;
  if owned_task.status = 'done' then
    raise exception 'completed tasks cannot start new sessions' using errcode = '55000';
  end if;
  if (owned_task.assignee_id is not null or cardinality(coalesce(owned_task.assignee_ids, '{}')) > 0)
     and actor_id is distinct from owned_task.assignee_id
     and not (actor_id = any(coalesce(owned_task.assignee_ids, '{}'))) then
    raise exception 'task is assigned to another user' using errcode = '42501';
  end if;
  select * into session_event from public.planner_events where id = p_event_id for update;
  if not found or session_event.user_id <> actor_id
    or session_event.organization_id <> owned_task.organization_id
    or session_event.task_id is distinct from owned_task.id
    or session_event.kind <> 'focus' or session_event.all_day then
    raise exception 'session is outside the authenticated task scope' using errcode = '42501';
  end if;
  if exists (select 1 from public.time_logs where planner_event_id = p_event_id) then
    raise exception 'session already has tracked time' using errcode = '55000';
  end if;

  -- Each focus block is its own attempt. Reuse stays off here even when the
  -- task already has a paused task-timer row. Switching pauses first so the
  -- one-open-segment index stays free for the new block.
  if p_from_time_log_id is null then
    select *
      into attempt
      from public.start_task_timer_attempt(p_task_id, p_started_at, p_time_zone, false);
  else
    perform 1
      from public.pause_time_attempt(p_from_time_log_id, p_started_at);
    select *
      into attempt
      from public.start_task_timer_attempt(p_task_id, p_started_at, p_time_zone, false);
  end if;

  -- The legacy starter clears the task's forecast. That forecast is a separate
  -- block, so restore it while still holding its row lock.
  update public.tasks set start_date = owned_task.start_date,
    scheduled_minutes = owned_task.scheduled_minutes where id = p_task_id;
  update public.time_logs set planner_event_id = session_event.id,
    planned_starts_at = session_event.starts_at,
    planned_minutes = round(extract(epoch from (session_event.ends_at - session_event.starts_at)) / 60)::integer
    where id = attempt.id returning * into attempt;
  return next attempt;
end;
$$;

revoke execute on function public.start_planner_task_session(uuid, uuid, timestamptz, uuid, text) from public, anon;
grant execute on function public.start_planner_task_session(uuid, uuid, timestamptz, uuid, text) to authenticated;

create or replace function public.start_planner_task_session(
  p_task_id uuid,
  p_event_id uuid,
  p_started_at timestamptz,
  p_from_time_log_id uuid default null
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select *
    from public.start_planner_task_session(
      p_task_id,
      p_event_id,
      p_started_at,
      p_from_time_log_id,
      null::text
    );
end;
$$;

revoke execute on function public.start_planner_task_session(uuid, uuid, timestamptz, uuid) from public, anon;
grant execute on function public.start_planner_task_session(uuid, uuid, timestamptz, uuid) to authenticated;

notify pgrst, 'reload schema';
