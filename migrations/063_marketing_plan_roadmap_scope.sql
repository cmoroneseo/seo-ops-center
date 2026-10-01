-- Roadmap inclusion is separate from task completion and calendar scheduling.
alter table public.marketing_plan_items
    add column roadmap_included boolean not null default false,
    add column roadmap_phase text not null default 'backlog'
        check (roadmap_phase in ('onboarding', 'month_1', 'month_2', 'month_3', 'backlog'));
-- Preserve legacy selections; do not assign relative months from calendar due dates.
update public.marketing_plan_items set roadmap_included = status <> 'ignored';

-- Lock the source row so retries and simultaneous scheduling cannot duplicate work.
create or replace function public.create_task_from_marketing_plan_item(p_item_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
    v_item public.marketing_plan_items%rowtype;
    v_task public.tasks%rowtype;
begin
    select * into v_item from public.marketing_plan_items where id = p_item_id for update;
    if not found then raise exception 'Plan item is unavailable'; end if;
    if not v_item.roadmap_included then raise exception 'Include this item in the roadmap before scheduling'; end if;
    if v_item.task_id is not null then
        select * into v_task from public.tasks where id = v_item.task_id;
        if not found or v_task.organization_id <> v_item.organization_id or v_task.client_id is distinct from v_item.client_id then raise exception 'Linked task is unavailable'; end if;
        return jsonb_build_object('task', to_jsonb(v_task), 'created', false);
    end if;
    if v_item.status <> 'todo' then raise exception 'Only open plan items can be scheduled'; end if;
    insert into public.tasks (
        organization_id, client_id, title, description, priority, status,
        assignee_ids, due_date, created_by, status_history
    ) values (
        v_item.organization_id, v_item.client_id, v_item.title, v_item.description,
        v_item.priority, 'todo',
        case when v_item.assignee_id is null then '{}'::uuid[] else array[v_item.assignee_id] end,
        v_item.due_date, auth.uid(),
        jsonb_build_array(jsonb_build_object('status', 'todo', 'at', now(), 'by', auth.uid()))
    ) returning * into v_task;
    update public.marketing_plan_items set task_id = v_task.id, updated_at = now() where id = v_item.id;
    return jsonb_build_object('task', to_jsonb(v_task), 'created', true);
end;
$$;
revoke all on function public.create_task_from_marketing_plan_item(uuid) from public;
grant execute on function public.create_task_from_marketing_plan_item(uuid) to authenticated;

-- Link an existing client task without copying it. Plan locking makes retries idempotent.
create or replace function public.add_existing_task_to_marketing_plan(p_plan_id uuid, p_task_id uuid, p_step_key text)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
    v_plan public.marketing_plans%rowtype;
    v_task public.tasks%rowtype;
    v_item_id uuid;
begin
    select * into v_plan from public.marketing_plans where id = p_plan_id for update;
    if not found then raise exception 'Plan is unavailable'; end if;
    if not exists (select 1 from jsonb_array_elements(v_plan.steps) step where step->>'key' = p_step_key) then
        raise exception 'Choose a valid plan category';
    end if;
    select * into v_task from public.tasks where id = p_task_id for update;
    if not found or v_task.organization_id <> v_plan.organization_id or v_task.client_id is distinct from v_plan.client_id then
        raise exception 'Task must belong to this client';
    end if;
    select id into v_item_id from public.marketing_plan_items where marketing_plan_id = p_plan_id and task_id = p_task_id;
    if found then
        update public.marketing_plan_items set roadmap_included = true, status = case when status = 'ignored' then 'todo' else status end where id = v_item_id;
        return v_item_id;
    end if;
    insert into public.marketing_plan_items (
        marketing_plan_id, organization_id, client_id, step_key, title, description,
        priority, status, due_date, task_id, is_custom, roadmap_included, sort_order
    ) values (
        v_plan.id, v_plan.organization_id, v_plan.client_id, p_step_key, v_task.title, v_task.description,
        case when v_task.priority = 'urgent' then 'high' else v_task.priority end,
        case when v_task.status in ('done','approved') then 'done' else 'todo' end,
        v_task.due_date, v_task.id, true, true,
        coalesce((select max(sort_order) + 1 from public.marketing_plan_items where marketing_plan_id = p_plan_id), 0)
    ) returning id into v_item_id;
    return v_item_id;
end;
$$;
revoke all on function public.add_existing_task_to_marketing_plan(uuid, uuid, text) from public;
grant execute on function public.add_existing_task_to_marketing_plan(uuid, uuid, text) to authenticated;

revoke execute on function public.create_task_from_marketing_plan_item(uuid) from anon;
revoke execute on function public.add_existing_task_to_marketing_plan(uuid, uuid, text) from anon;
