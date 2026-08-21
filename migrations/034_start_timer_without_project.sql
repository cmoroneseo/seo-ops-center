-- Migration 034: allow a project-less task to start its timer
--
-- Migration 033's start_task_timer resolved public.projects unconditionally and
-- raised 23514 when no row matched. Because migration 014 made tasks.project_id
-- nullable -- tasks are created from the client page without a project -- that
-- guard rejected Start for every project-less task, which is most of them.
--
-- This replaces the function so the project/tenant guard only runs when the task
-- actually carries a project_id, mirroring finalize_time_attempt. Nothing else
-- changes: ownership, assignment claiming, client-tenant checks, the advisory
-- lock, and the forecast snapshot are all preserved verbatim.
--
-- switch_time_attempt delegates its task-target start to start_task_timer, so it
-- inherits this fix without its own change.

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
