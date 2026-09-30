-- Monthly execution reuses tasks for dates, estimates, ownership and status.
alter table public.marketing_plans add column if not exists goal text;

-- Lock the source row so retries and simultaneous scheduling cannot duplicate work.
create or replace function public.create_task_from_marketing_plan_item(p_item_id uuid)
returns public.tasks
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
    if v_item.task_id is not null then
        select * into v_task from public.tasks where id = v_item.task_id;
        if not found then raise exception 'Linked task is unavailable'; end if;
        return v_task;
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
    return v_task;
end;
$$;
revoke all on function public.create_task_from_marketing_plan_item(uuid) from public;
grant execute on function public.create_task_from_marketing_plan_item(uuid) to authenticated;
