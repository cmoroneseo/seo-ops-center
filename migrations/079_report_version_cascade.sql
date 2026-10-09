-- 079: deleting a client or organization removes frozen report versions.
-- 075 is reserved. 078 is the monthly draft uniqueness index.
--
-- report_versions blocks update and delete. reports and report_reviews
-- reference reports with ON DELETE RESTRICT, and versions also reference
-- clients and organizations with ON DELETE CASCADE. Once a version exists,
-- deleting the client or the organization fails: the restrict fires, and the
-- immutability trigger rejects the cascade delete.
--
-- A direct update is still rejected. A direct delete is still rejected.
-- A delete is allowed only while another trigger is already on the stack
-- (pg_trigger_depth() > 1). The only trigger that deletes versions is
-- cascade_report_history, which runs before the client or organization row
-- goes away and removes reviews first so the version foreign key is clear.
-- Deleting a report on its own still stops when a version exists.
--
-- Rollback:
-- drop trigger if exists clients_cascade_report_history on public.clients;
-- drop trigger if exists organizations_cascade_report_history on public.organizations;
-- drop function if exists public.cascade_report_history();
-- create or replace function public.report_versions_immutable()
-- returns trigger language plpgsql set search_path = public as $$
-- begin
--   raise exception 'report_versions are immutable' using errcode = '55000';
-- end $$;

create or replace function public.report_versions_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'report_versions are immutable'
    using errcode = '55000';
end $$;

create or replace function public.cascade_report_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op is distinct from 'DELETE' then
    raise exception 'report history cascade is delete-only'
      using errcode = '55000';
  end if;

  if tg_table_name = 'clients' then
    delete from public.report_reviews where client_id = old.id;
    delete from public.report_versions where client_id = old.id;
  elsif tg_table_name = 'organizations' then
    delete from public.report_reviews where organization_id = old.id;
    delete from public.report_versions where organization_id = old.id;
  else
    raise exception 'report history cascade is not for this table'
      using errcode = '55000';
  end if;

  return old;
end $$;

revoke all on function public.cascade_report_history() from public, anon, authenticated;
grant execute on function public.cascade_report_history() to authenticated, service_role;

drop trigger if exists clients_cascade_report_history on public.clients;
create trigger clients_cascade_report_history
  before delete on public.clients
  for each row
  execute function public.cascade_report_history();

drop trigger if exists organizations_cascade_report_history on public.organizations;
create trigger organizations_cascade_report_history
  before delete on public.organizations
  for each row
  execute function public.cascade_report_history();
