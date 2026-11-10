-- Migration 126: link a work-plan task to one campaign initiative.
--
-- NOT APPLIED. Do not run this against the production Supabase project
-- (sgszojorcftyaknruckh). The owner reviews and applies it separately.
-- Not applied in this change.
--
-- Nullable tasks.initiative_id. No default and no backfill.
-- The foreign key is (initiative_id, organization_id, client_id)
-- referencing campaign_initiatives (id, organization_id, client_id).
-- A task can only point at an initiative for the same organization and client.
-- Deleting that initiative sets only initiative_id to null.
-- organization_id and client_id stay on the task.
-- A task with no client cannot keep the link.
-- A nested task cannot keep the link: parent_task_id clears initiative_id.
-- RLS is unchanged. No seed.

alter table public.tasks
  add column if not exists initiative_id uuid;

alter table public.tasks
  drop constraint if exists tasks_initiative_fkey;

alter table public.tasks
  add constraint tasks_initiative_fkey
  foreign key (initiative_id, organization_id, client_id)
  references public.campaign_initiatives (id, organization_id, client_id)
  on delete set null (initiative_id);

alter table public.tasks
  drop constraint if exists tasks_initiative_client_check;

alter table public.tasks
  add constraint tasks_initiative_client_check
  check (initiative_id is null or client_id is not null);

create index if not exists tasks_initiative_id_idx
  on public.tasks (initiative_id);

comment on column public.tasks.initiative_id is
  'Campaign initiative this top-level task belongs to. Null means not linked. Cleared when that initiative is deleted. organization_id and client_id are not cleared.';

create or replace function public.clear_nested_task_initiative()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.parent_task_id is not null then
    new.initiative_id := null;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_nested_task_initiative() from public, anon;
grant execute on function public.clear_nested_task_initiative() to authenticated, service_role;

drop trigger if exists tasks_clear_nested_initiative on public.tasks;
create trigger tasks_clear_nested_initiative
  before insert or update of parent_task_id, initiative_id on public.tasks
  for each row execute function public.clear_nested_task_initiative();
