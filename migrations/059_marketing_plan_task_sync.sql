-- =============================================================================
-- 059: Marketing plan checklist follows the linked task
-- =============================================================================
-- Task status is written from several places that do not share a helper:
--   * lib/supabase/tasks.ts updateTask (task modal, planner, calendar)
--   * app/api/time-tracking/route.ts completeOwnedTask (timer finalize)
--   * app/api/integrations/basecamp/webhook updateTaskStatus (service role)
-- A hook inside updateTask misses the API writers. Realtime only refreshes a
-- browser that is open; it does not persist the checklist row. The link is
-- marketing_plan_items.task_id, so the durable sync is an AFTER UPDATE trigger
-- on tasks.status.
--
-- Rules (ignored items are never rewritten):
--   * task status becomes done or approved → item todo becomes done
--   * task status leaves done/approved → item done becomes todo
-- Checking a linked item in the UI completes or reopens the task through
-- updateTask; this trigger is what writes the item. Unchecking does not
-- rewind a task that is already in progress, review, or blocked — that case
-- only updates the item (see checklistTogglePlan in lib/marketing-plan-logic.ts).
-- =============================================================================

create index if not exists marketing_plan_items_task_idx
  on public.marketing_plan_items (task_id)
  where task_id is not null;

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

  if new.status in ('done', 'approved') then
    update public.marketing_plan_items
      set status = 'done',
          updated_at = timezone('utc', now())
      where task_id = new.id
        and organization_id = new.organization_id
        and status = 'todo';
  else
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

-- Catch up items already linked to a finished task. Do not uncheck items
-- someone marked done by hand while the task was still open.
update public.marketing_plan_items as item
set status = 'done',
    updated_at = timezone('utc', now())
from public.tasks as task
where item.task_id = task.id
  and item.organization_id = task.organization_id
  and item.status = 'todo'
  and task.status in ('done', 'approved');
