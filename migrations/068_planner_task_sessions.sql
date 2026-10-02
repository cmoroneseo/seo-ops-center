-- Sidebar scheduling inserts task-linked focus events. Legacy tasks.start_date
-- blocks remain intact. Timer starts consume only the selected event snapshot.
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

  -- Reuse assignment claiming, project/client validation, and the one-running-
  -- timer invariant. Switching pauses the previous timer in this transaction.
  if p_from_time_log_id is null then
    select * into attempt from public.start_task_timer(p_task_id, p_started_at);
  else
    select switched.* into attempt from public.switch_time_attempt(
      p_from_time_log_id, null, p_task_id, p_started_at
    ) as switched where switched.id <> p_from_time_log_id;
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

revoke execute on function public.start_planner_task_session(uuid, uuid, timestamptz, uuid) from public, anon;
grant execute on function public.start_planner_task_session(uuid, uuid, timestamptz, uuid) to authenticated;
