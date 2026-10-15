-- Migration 100: store new time on a pillar task
--
-- Subtasks already use tasks.parent_task_id (migration 012). Recurring
-- successors reuse that column, copy recurrence, and keep the parent title.
-- Only a real subtask (no recurrence, different title, same organization)
-- redirects time onto its parent.
--
-- start_task_timer resolves before the assignment claim, so the actor is
-- checked against the pillar rather than silently claimed onto the chore.
-- A BEFORE INSERT trigger covers manual logs and completion-time inserts.
-- Service-role writes (Basecamp timesheet import) keep the task id they were
-- given, because auth.uid() is null.
--
-- Campaign Desk is not modified. It reads the stored time_logs.task_id.
-- Existing rows are not rewritten. Subtasks created for a pillar have no
-- start_date, so they are not separate forecast blocks.

create or replace function public.resolve_time_tracking_task_id(p_task_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when p_task_id is null or auth.uid() is null then p_task_id
    else coalesce(
      (
        select parent.id
        from public.tasks as child
        join public.tasks as parent
          on parent.id = child.parent_task_id
         and parent.organization_id = child.organization_id
        where child.id = p_task_id
          and child.recurrence is null
          and parent.title is distinct from child.title
          and exists (
            select 1
            from public.organization_members as member
            where member.organization_id = child.organization_id
              and member.user_id = auth.uid()
          )
        limit 1
      ),
      p_task_id
    )
  end;
$$;

revoke all on function public.resolve_time_tracking_task_id(uuid) from public, anon, authenticated;

create or replace function public.prefer_pillar_on_time_log()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.task_id is not null then
    new.task_id := public.resolve_time_tracking_task_id(new.task_id);
  end if;
  return new;
end;
$$;

revoke all on function public.prefer_pillar_on_time_log() from public, anon, authenticated;

drop trigger if exists prefer_pillar_on_time_log on public.time_logs;
create trigger prefer_pillar_on_time_log
  before insert on public.time_logs
  for each row
  execute function public.prefer_pillar_on_time_log();

-- Supersedes migration 034. The project-less guard is unchanged; the looked-up
-- task is the pillar when the requested id is a subtask.
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
