-- =============================================================================
-- 033: Planner actual-time attempts and segments
-- =============================================================================
-- Additive persistence for task timer attempts. Forecast data is snapshotted on
-- the attempt, while actual work is represented by one or more closed/open
-- segments. All browser-callable transitions derive tenant and actor authority
-- from auth.uid() plus trusted database rows.
-- =============================================================================

alter table public.time_logs
  add column if not exists planned_starts_at timestamptz,
  add column if not exists planned_minutes integer,
  add column if not exists reviewing_at timestamptz,
  add column if not exists operation_id uuid;

alter table public.time_logs
  drop constraint if exists time_logs_planned_minutes_positive;
alter table public.time_logs
  add constraint time_logs_planned_minutes_positive
  check (planned_minutes is null or planned_minutes > 0);

alter table public.client_activity_log
  add column if not exists operation_id uuid;

create index if not exists client_activity_log_operation_idx
  on public.client_activity_log (client_id, operation_id)
  where operation_id is not null;

create table if not exists public.time_log_segments (
  id uuid primary key default uuid_generate_v4(),
  time_log_id uuid not null references public.time_logs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint time_log_segments_positive check (ended_at is null or ended_at > started_at)
);

-- This composite identity is the concurrency-safe parent/child authority. The
-- foreign key's PostgreSQL RI locks serialize a segment insert against a
-- concurrent parent tenant/owner update in either statement order.
alter table public.time_logs
  add constraint time_logs_segment_parent_key
  unique (id, organization_id, user_id);

alter table public.time_log_segments
  add constraint time_log_segments_parent_identity_fkey
  foreign key (time_log_id, organization_id, user_id)
  references public.time_logs (id, organization_id, user_id)
  on delete cascade;

create unique index if not exists one_open_time_segment_per_user
  on public.time_log_segments (organization_id, user_id)
  where ended_at is null;

create index if not exists time_log_segments_attempt_idx
  on public.time_log_segments (time_log_id, started_at);

create index if not exists time_log_segments_owner_idx
  on public.time_log_segments (organization_id, user_id, started_at);

alter table public.time_log_segments enable row level security;

create policy "Org members can view time log segments"
  on public.time_log_segments for select
  using (organization_id in (select get_user_org_ids()));

create policy "Users can insert their own time log segments"
  on public.time_log_segments for insert
  with check (
    user_id = auth.uid()
    and organization_id in (select get_user_org_ids())
  );

create policy "Users can update their own time log segments"
  on public.time_log_segments for update
  using (
    user_id = auth.uid()
    and organization_id in (select get_user_org_ids())
  )
  with check (
    user_id = auth.uid()
    and organization_id in (select get_user_org_ids())
  );

create policy "Users can delete their own time log segments"
  on public.time_log_segments for delete
  using (
    user_id = auth.uid()
    and organization_id in (select get_user_org_ids())
  );

create or replace function public.enforce_time_log_segment_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_organization_id uuid;
  parent_user_id uuid;
begin
  select time_logs.organization_id, time_logs.user_id
    into parent_organization_id, parent_user_id
    from public.time_logs
    where time_logs.id = new.time_log_id;

  if not found then
    raise exception 'time log segment parent does not exist'
      using errcode = '23503';
  end if;

  if new.organization_id is distinct from parent_organization_id
     or new.user_id is distinct from parent_user_id then
    raise exception 'time log segment tenant or owner differs from parent log'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_time_log_segment_parent() from public, anon, authenticated;

create trigger enforce_time_log_segment_parent
  before insert or update of time_log_id, organization_id, user_id
  on public.time_log_segments
  for each row execute function public.enforce_time_log_segment_parent();

create or replace function public.protect_segmented_time_log_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.organization_id is distinct from old.organization_id
    or new.user_id is distinct from old.user_id
  ) and exists (
    select 1
    from public.time_log_segments
    where time_log_segments.time_log_id = old.id
  ) then
    raise exception 'segmented time log tenant and owner are immutable'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_segmented_time_log_parent() from public, anon, authenticated;

create trigger protect_segmented_time_log_parent
  before update of organization_id, user_id
  on public.time_logs
  for each row execute function public.protect_segmented_time_log_parent();

-- Only a legacy row that was actively running has a trustworthy segment start.
-- row_number handles invalid legacy duplicates conservatively while the partial
-- unique index preserves the one-running-timer invariant.
with legacy_running as (
  select
    time_logs.id,
    time_logs.organization_id,
    time_logs.user_id,
    time_logs.timer_started_at,
    row_number() over (
      partition by time_logs.organization_id, time_logs.user_id
      order by time_logs.timer_started_at desc, time_logs.id
    ) as owner_rank
  from public.time_logs
  where time_logs.status = 'in_progress'
    and time_logs.timer_started_at is not null
    and time_logs.user_id is not null
    and not exists (
      select 1
      from public.time_log_segments
      where time_log_segments.time_log_id = time_logs.id
    )
)
insert into public.time_log_segments (
  time_log_id,
  organization_id,
  user_id,
  started_at
)
select
  legacy_running.id,
  legacy_running.organization_id,
  legacy_running.user_id,
  legacy_running.timer_started_at
from legacy_running
where legacy_running.owner_rank = 1
on conflict do nothing;

create or replace function public.start_task_timer(
  p_task_id uuid,
  p_started_at timestamptz
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
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_started_at is null then
    raise exception 'timer start timestamp is required' using errcode = '22004';
  end if;

  select tasks.*
    into owned_task
    from public.tasks
    where tasks.id = p_task_id
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
    (p_started_at at time zone 'UTC')::date,
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

  update public.tasks
    set start_date = null,
        scheduled_minutes = null
    where tasks.id = owned_task.id;

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

revoke execute on function public.start_task_timer(uuid, timestamptz) from public, anon;
grant execute on function public.start_task_timer(uuid, timestamptz) to authenticated;

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
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_paused_at is null then
    raise exception 'pause timestamp is required' using errcode = '22004';
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

revoke execute on function public.pause_time_attempt(uuid, timestamptz) from public, anon;
grant execute on function public.pause_time_attempt(uuid, timestamptz) to authenticated;

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
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_resumed_at is null then
    raise exception 'resume timestamp is required' using errcode = '22004';
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

revoke execute on function public.resume_time_attempt(uuid, timestamptz) from public, anon;
grant execute on function public.resume_time_attempt(uuid, timestamptz) to authenticated;

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
declare
  actor_id uuid := auth.uid();
  paused_attempt public.time_logs%rowtype;
  active_attempt public.time_logs%rowtype;
  target_task public.tasks%rowtype;
  target_segment public.time_log_segments%rowtype;
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
    select time_logs.*
      into active_attempt
      from public.time_logs
      where time_logs.task_id = p_to_task_id
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
        where tasks.id = p_to_task_id
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
        from public.start_task_timer(p_to_task_id, p_switched_at) as started
        limit 1;
    end if;
  end if;

  return next paused_attempt;
  return next active_attempt;
end;
$$;

revoke execute on function public.switch_time_attempt(uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.switch_time_attempt(uuid, uuid, uuid, timestamptz) to authenticated;

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
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_reviewing_at is null then
    raise exception 'review timestamp is required' using errcode = '22004';
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

revoke execute on function public.begin_stop_review(uuid, timestamptz) from public, anon;
grant execute on function public.begin_stop_review(uuid, timestamptz) to authenticated;

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

revoke execute on function public.finalize_time_attempt(uuid, text, boolean, boolean, text, uuid, timestamptz) from public, anon;
grant execute on function public.finalize_time_attempt(uuid, text, boolean, boolean, text, uuid, timestamptz) to authenticated;
