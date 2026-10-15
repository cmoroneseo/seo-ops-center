-- Link an imported onboarding task onto the checklist row that already
-- describes that work. Does not insert a second row, and does not change
-- template_key or source. Rows that have no checklist twin still go through
-- add_existing_task_to_marketing_plan, which stamps source = 'basecamp'.
-- Existing rows are not rewritten.

create or replace function public.link_task_onto_marketing_plan_item(p_item_id uuid, p_task_id uuid)
returns uuid
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
    select * into v_task from public.tasks where id = p_task_id for update;
    if not found
       or v_task.organization_id <> v_item.organization_id
       or v_task.client_id is distinct from v_item.client_id then
        raise exception 'Task must belong to this client';
    end if;
    if exists (
        select 1 from public.marketing_plan_items
        where marketing_plan_id = v_item.marketing_plan_id
          and task_id = p_task_id
          and id <> v_item.id
    ) then
        raise exception 'Task is already on this plan';
    end if;
    if v_item.task_id is not null and v_item.task_id <> p_task_id then
        raise exception 'Plan item already has a task';
    end if;
    update public.marketing_plan_items
    set task_id = v_task.id,
        roadmap_included = true,
        roadmap_phase = case
            when roadmap_phase in ('month_1', 'month_2', 'month_3') then roadmap_phase
            else 'onboarding'
        end,
        status = case
            when v_task.status in ('done', 'approved') then 'done'
            when status = 'ignored' then 'todo'
            else status
        end,
        updated_at = timezone('utc', now())
    where id = v_item.id;
    return v_item.id;
end;
$$;

revoke all on function public.link_task_onto_marketing_plan_item(uuid, uuid) from public, anon;
grant execute on function public.link_task_onto_marketing_plan_item(uuid, uuid) to authenticated;
