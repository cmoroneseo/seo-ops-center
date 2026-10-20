-- Migration 110: task status is todo, in progress, or done.
--
-- Review becomes in progress. Approved becomes done and keeps completed_at,
-- or backfills it from the latest done/approved history stamp, then updated_at.
-- Blocked returns to the previous non-blocked history status (else todo) and
-- gains a removable blocked_reason. A row restored to done does not keep the
-- label, because marking done clears it. Done rows missing completed_at are
-- backfilled the same way. A second run matches no rows.
--
-- The checklist trigger is replaced before the data update. Only done completes
-- a linked item, and only leaving done reopens it, so review -> in progress
-- does not uncheck work someone already marked done.
--
-- The completion trigger is installed after the backfill so historical
-- completed_at values are not replaced with now().
--
-- Operator: run this on production BEFORE applying the migration to record
-- the before counts. Do not run the migration from the app.
--
--   select status,
--          count(*) as rows,
--          count(*) filter (where completed_at is null) as missing_completed_at
--   from public.tasks
--   group by status
--   order by status;

alter table public.tasks
  add column if not exists blocked_reason text;

-- Checklist sync first, so the status rewrite does not uncheck open items.
create or replace function public.sync_marketing_plan_item_from_task()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'done' then
    update public.marketing_plan_items
      set status = 'done',
          updated_at = timezone('utc', now())
      where task_id = new.id
        and organization_id = new.organization_id
        and status = 'todo';
  elsif old.status = 'done' then
    update public.marketing_plan_items
      set status = 'todo',
          updated_at = timezone('utc', now())
      where task_id = new.id
        and organization_id = new.organization_id
        and status = 'done';
  end if;

  return new;
end;
$$;

drop trigger if exists sync_marketing_plan_item_from_task on public.tasks;
create trigger sync_marketing_plan_item_from_task
  after update of status on public.tasks
  for each row
  execute function public.sync_marketing_plan_item_from_task();

create or replace function public.task_status_history_timestamptz(p_value text)
returns timestamptz
language plpgsql
stable
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  return p_value::timestamptz;
exception
  when others then
    return null;
end;
$$;

revoke all on function public.task_status_history_timestamptz(text) from public, anon, authenticated;

with restored as (
  select
    tasks.id,
    tasks.status as old_status,
    case
      when tasks.status = 'blocked' then coalesce(
        (
          select entry->>'status'
          from jsonb_array_elements(
            case
              when jsonb_typeof(tasks.status_history) = 'array' then tasks.status_history
              else '[]'::jsonb
            end
          ) with ordinality as hist(entry, ord)
          where coalesce(entry->>'status', '') <> ''
            and entry->>'status' <> 'blocked'
          order by ord desc
          limit 1
        ),
        'todo'
      )
      else tasks.status
    end as restored_status
  from public.tasks
  where tasks.status in ('review', 'approved', 'blocked')
     or (tasks.status = 'done' and tasks.completed_at is null)
     or tasks.status not in ('todo', 'in_progress', 'review', 'approved', 'blocked', 'done')
     or (tasks.status in ('todo', 'in_progress') and tasks.completed_at is not null)
),
mapped as (
  select
    id,
    old_status,
    case
      when restored_status in ('todo', 'in_progress', 'done') then restored_status
      when restored_status = 'review' then 'in_progress'
      when restored_status = 'approved' then 'done'
      else 'todo'
    end as next_status
  from restored
)
update public.tasks as task
set
  status = mapped.next_status,
  completed_at = case
    when mapped.next_status = 'done' then coalesce(
      task.completed_at,
      (
        select public.task_status_history_timestamptz(entry->>'at')
        from jsonb_array_elements(
          case
            when jsonb_typeof(task.status_history) = 'array' then task.status_history
            else '[]'::jsonb
          end
        ) with ordinality as hist(entry, ord)
        where entry->>'status' in ('done', 'approved')
          and public.task_status_history_timestamptz(entry->>'at') is not null
        order by ord desc
        limit 1
      ),
      task.updated_at,
      timezone('utc', now())
    )
    else null
  end,
  blocked_reason = case
    when mapped.next_status = 'done' then null
    when mapped.old_status = 'blocked' and nullif(btrim(task.blocked_reason), '') is null
      then 'Migrated from Blocked status'
    else task.blocked_reason
  end,
  status_history = case
    when mapped.next_status is distinct from task.status then
      case
        when jsonb_typeof(task.status_history) = 'array' then task.status_history
        else '[]'::jsonb
      end || jsonb_build_array(jsonb_build_object(
        'status', mapped.next_status,
        'at', to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'by', 'status-simplification'
      ))
    else task.status_history
  end
from mapped
where task.id = mapped.id;

alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks
  add constraint tasks_status_check
  check (status in ('todo', 'in_progress', 'done'));

alter table public.tasks drop constraint if exists tasks_blocked_reason_check;
alter table public.tasks
  add constraint tasks_blocked_reason_check
  check (
    blocked_reason is null
    or (
      char_length(blocked_reason) between 1 and 200
      and blocked_reason = btrim(blocked_reason)
      and position(E'\n' in blocked_reason) = 0
      and position(E'\r' in blocked_reason) = 0
    )
  );

create or replace function public.sync_task_completion_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'done' then
    if new.completed_at is null then
      new.completed_at := timezone('utc', now());
    end if;
    new.blocked_reason := null;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_task_completion_fields on public.tasks;
create trigger sync_task_completion_fields
  before insert or update on public.tasks
  for each row
  execute function public.sync_task_completion_fields();

create or replace function public.note_timer_started_on_task(
  p_task_id uuid,
  p_started_at timestamptz,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.tasks
    set status = 'in_progress',
        status_history = coalesce(
          case
            when jsonb_typeof(status_history) = 'array' then status_history
            else '[]'::jsonb
          end,
          '[]'::jsonb
        ) || jsonb_build_array(jsonb_build_object(
          'status', 'in_progress',
          'at', to_char(timezone('utc', p_started_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'by', p_actor_id
        ))
    where id = p_task_id
      and status = 'todo';
end;
$$;

revoke all on function public.note_timer_started_on_task(uuid, timestamptz, uuid) from public, anon, authenticated;


-- Supersedes migration 101. The project-less guard is unchanged.
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

revoke execute on function public.start_task_timer(uuid, timestamptz) from public, anon;
grant execute on function public.start_task_timer(uuid, timestamptz) to authenticated;

create or replace function public.create_task_from_search_investigation(
  p_investigation_id uuid,
  p_task jsonb
)
returns public.tasks
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_investigation public.search_investigations%rowtype;
  v_task public.tasks%rowtype;
  v_title text;
  v_status text;
  v_priority text;
  v_assignee_ids uuid[];
  v_watcher_ids uuid[];
  v_tags text[];
begin
  if jsonb_typeof(p_task) <> 'object' then
    raise exception 'Task payload must be an object';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_task) key
    where key <> all (array[
      'title', 'description', 'assigneeIds', 'watcherIds', 'dueDate', 'startDate',
      'priority', 'status', 'category', 'tags', 'estimatedHours', 'scheduledMinutes',
      'deliverableId', 'sortOrder', 'templateId', 'recurrence', 'campaignPhaseId'
    ])
  ) then
    raise exception 'Task payload contains unsupported fields';
  end if;

  select * into v_investigation
  from public.search_investigations
  where id = p_investigation_id
  for update;
  if not found then
    raise exception 'Investigation is not available to this user';
  end if;

  if v_investigation.task_id is not null then
    select * into v_task from public.tasks where id = v_investigation.task_id;
    if not found then
      raise exception 'Linked task is unavailable';
    end if;
    return v_task;
  end if;
  if v_investigation.status = 'dismissed' then
    raise exception 'Restore the investigation before creating a task';
  end if;

  v_title := btrim(p_task ->> 'title');
  v_status := coalesce(nullif(p_task ->> 'status', ''), 'todo');
  v_priority := coalesce(nullif(p_task ->> 'priority', ''), 'medium');
  if v_title is null or length(v_title) = 0 or length(v_title) > 500 then
    raise exception 'Task title must contain 1 to 500 characters';
  end if;
  if v_status not in ('todo', 'in_progress', 'done') then
    raise exception 'Invalid task status';
  end if;
  if v_priority not in ('low', 'medium', 'high', 'urgent') then
    raise exception 'Invalid task priority';
  end if;
  if p_task ? 'assigneeIds' and jsonb_typeof(p_task -> 'assigneeIds') <> 'array' then
    raise exception 'Task assigneeIds must be an array';
  end if;
  if p_task ? 'watcherIds' and jsonb_typeof(p_task -> 'watcherIds') <> 'array' then
    raise exception 'Task watcherIds must be an array';
  end if;
  if p_task ? 'tags' and jsonb_typeof(p_task -> 'tags') <> 'array' then
    raise exception 'Task tags must be an array';
  end if;

  select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_assignee_ids
  from jsonb_array_elements_text(coalesce(p_task -> 'assigneeIds', '[]'::jsonb));
  select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_watcher_ids
  from jsonb_array_elements_text(coalesce(p_task -> 'watcherIds', '[]'::jsonb));
  select coalesce(array_agg(btrim(value)), '{}'::text[]) into v_tags
  from jsonb_array_elements_text(coalesce(p_task -> 'tags', '[]'::jsonb));

  insert into public.tasks (
    organization_id, client_id, title, description, status, priority, category,
    tags, assignee_ids, watcher_ids, due_date, start_date, estimated_hours,
    scheduled_minutes, deliverable_id, sort_order, created_by, template_id,
    recurrence, campaign_phase_id, custom_fields, status_history
  ) values (
    v_investigation.organization_id,
    v_investigation.client_id,
    v_title,
    nullif(p_task ->> 'description', ''),
    v_status,
    v_priority,
    nullif(p_task ->> 'category', ''),
    v_tags,
    v_assignee_ids,
    v_watcher_ids,
    nullif(p_task ->> 'dueDate', '')::timestamptz,
    nullif(p_task ->> 'startDate', '')::timestamptz,
    nullif(p_task ->> 'estimatedHours', '')::numeric,
    nullif(p_task ->> 'scheduledMinutes', '')::integer,
    nullif(p_task ->> 'deliverableId', '')::uuid,
    coalesce(nullif(p_task ->> 'sortOrder', '')::integer, 0),
    auth.uid(),
    nullif(p_task ->> 'templateId', '')::uuid,
    p_task -> 'recurrence',
    nullif(p_task ->> 'campaignPhaseId', '')::uuid,
    jsonb_build_object(
      'search_investigation_id', v_investigation.id,
      'search_investigation_source', 'gsc'
    ),
    jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'status', v_status,
      'at', timezone('utc', now()),
      'by', auth.uid()
    )))
  )
  returning * into v_task;

  update public.search_investigations
  set status = 'task_created', task_id = v_task.id,
      dismissal_reason = null, dismissal_note = null
  where id = v_investigation.id;

  return v_task;
end;
$$;

revoke all on function public.create_task_from_search_investigation(uuid, jsonb) from public, anon;
grant execute on function public.create_task_from_search_investigation(uuid, jsonb) to authenticated, service_role;

drop function if exists public.task_status_history_timestamptz(text);
