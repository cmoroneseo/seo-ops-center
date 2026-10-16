-- Migration 104: atomic SEO Plan stage reorder.
-- One call rewrites stage, position, and parent_task_id for the rows the
-- caller names. Task RLS lets every organization member write, so viewers
-- are rejected here before any row changes. A failed check aborts the
-- transaction, including rows already updated in this call.

create or replace function public.reorder_stage_tasks(
  p_organization_id uuid,
  p_client_id uuid,
  p_patches jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  patch_count integer;
  locked_count integer;
  updated_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required to move tasks.'
      using errcode = '42501';
  end if;

  if p_organization_id is null or p_client_id is null or p_patches is null or jsonb_typeof(p_patches) <> 'array' then
    raise exception 'Choose a task to move.'
      using errcode = '22023';
  end if;

  patch_count := jsonb_array_length(p_patches);
  if patch_count < 1 or patch_count > 500 then
    raise exception 'Choose a task to move.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.organization_members as member
    where member.organization_id = p_organization_id
      and member.user_id = actor_id
      and member.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_patches) as patch(
      id uuid,
      stage text,
      position double precision,
      parent_task_id uuid
    )
    where patch.id is null
      or patch.stage not in ('onboarding', 'month_1', 'month_2', 'month_3', 'backlog')
      or patch.position is null
      or patch.position < 0
      or patch.position >= 'Infinity'::float8
  ) or (
    select count(distinct patch.id)
    from jsonb_to_recordset(p_patches) as patch(id uuid)
  ) <> patch_count then
    raise exception 'Choose a task to move.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_id::text, 0));

  perform task.id
  from public.tasks as task
  where task.organization_id = p_organization_id
    and task.client_id = p_client_id
    and task.id in (
      select patch.id
      from jsonb_to_recordset(p_patches) as patch(id uuid)
    )
  for update;

  get diagnostics locked_count = row_count;
  if locked_count <> patch_count then
    raise exception 'Not found'
      using errcode = '42501';
  end if;

  update public.tasks as task
     set stage = patch.stage,
         position = patch.position,
         parent_task_id = patch.parent_task_id
    from jsonb_to_recordset(p_patches) as patch(
      id uuid,
      stage text,
      position double precision,
      parent_task_id uuid
    )
   where task.id = patch.id
     and task.organization_id = p_organization_id
     and task.client_id = p_client_id;

  get diagnostics updated_count = row_count;
  if updated_count <> patch_count then
    raise exception 'Not found'
      using errcode = '42501';
  end if;

  -- One level only. A subtask's parent is a top-level task, and a task that
  -- still has subtasks cannot itself sit under a parent.
  if exists (
    select 1
    from public.tasks as child
    join public.tasks as parent on parent.id = child.parent_task_id
    where child.organization_id = p_organization_id
      and child.client_id = p_client_id
      and child.id in (
        select patch.id
        from jsonb_to_recordset(p_patches) as patch(id uuid)
      )
      and (
        parent.organization_id is distinct from p_organization_id
        or parent.client_id is distinct from p_client_id
        or parent.parent_task_id is not null
        or parent.id = child.id
        or exists (
          select 1
          from public.tasks as grandchild
          where grandchild.parent_task_id = child.id
            and grandchild.id is distinct from child.id
            and grandchild.recurrence is null
            and grandchild.title is distinct from child.title
        )
      )
  ) then
    raise exception 'Tasks can only nest one level deep'
      using errcode = '22023';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', task.id,
      'title', task.title,
      'status', task.status,
      'stage', task.stage,
      'position', task.position,
      'parent_task_id', task.parent_task_id,
      'created_at', task.created_at,
      'category', task.category,
      'basecamp_todo_id', task.basecamp_todo_id,
      'recurrence', task.recurrence
    )), '[]'::jsonb)
    from public.tasks as task
    where task.organization_id = p_organization_id
      and task.client_id = p_client_id
      and task.id in (
        select patch.id
        from jsonb_to_recordset(p_patches) as patch(id uuid)
      )
  );
end;
$$;

revoke all on function public.reorder_stage_tasks(uuid, uuid, jsonb) from public, anon;
grant execute on function public.reorder_stage_tasks(uuid, uuid, jsonb) to authenticated;
