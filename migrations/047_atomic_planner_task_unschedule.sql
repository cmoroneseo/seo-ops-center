-- =============================================================================
-- 047: Atomic planner task unscheduling and optional prioritization
-- =============================================================================

-- Keep the earliest existing linked priority before enforcing one priority per
-- task for each user. Free-text priorities are intentionally unaffected.
with ranked_task_priorities as (
  select
    id,
    row_number() over (
      partition by organization_id, user_id, task_id
      order by sort_order, created_at, id
    ) as duplicate_rank
  from public.planner_priorities
  where task_id is not null
)
delete from public.planner_priorities as priorities
using ranked_task_priorities as ranked
where priorities.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index if not exists planner_priorities_org_user_task_uniq
  on public.planner_priorities (organization_id, user_id, task_id)
  where task_id is not null;

create or replace function public.unschedule_planner_task(
  p_task_id uuid,
  p_add_to_priorities boolean
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  owned_task public.tasks%rowtype;
  next_sort_order integer;
  changed_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required to unschedule a planner task.'
      using errcode = '42501';
  end if;

  if p_task_id is null or p_add_to_priorities is null then
    raise exception 'Task ID and priority choice are required.'
      using errcode = '22004';
  end if;

  -- SECURITY INVOKER means the task lookup and update remain subject to the
  -- caller's existing task RLS policies. Locking also serializes repeat drops.
  select tasks.*
    into owned_task
    from public.tasks as tasks
   where tasks.id = p_task_id
   for update;

  if not found then
    raise exception 'Planner task was not found or is outside the authenticated organization.'
      using errcode = '42501';
  end if;

  update public.tasks
     set start_date = null,
         scheduled_minutes = null
   where id = owned_task.id;

  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'Planner task unschedule conflict.'
      using errcode = 'P0001';
  end if;

  if p_add_to_priorities then
    -- All new priorities for one user share this transaction lock, preventing
    -- simultaneous drops from choosing the same bottom sort position.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'planner-priority:' || owned_task.organization_id::text || ':' || actor_id::text,
        0
      )
    );

    select coalesce(max(priorities.sort_order) + 1, 0)
      into next_sort_order
      from public.planner_priorities as priorities
     where priorities.organization_id = owned_task.organization_id
       and priorities.user_id = actor_id;

    insert into public.planner_priorities (
      organization_id,
      user_id,
      task_id,
      sort_order
    ) values (
      owned_task.organization_id,
      actor_id,
      owned_task.id,
      next_sort_order
    )
    on conflict (organization_id, user_id, task_id)
      where task_id is not null
    do nothing;
  end if;

  return true;
end;
$$;

revoke execute on function public.unschedule_planner_task(uuid, boolean)
  from public, anon;
grant execute on function public.unschedule_planner_task(uuid, boolean)
  to authenticated;
