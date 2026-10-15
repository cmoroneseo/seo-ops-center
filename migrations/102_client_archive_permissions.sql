-- Archive (clients.status = inactive, shown as Cancelled) and hard delete are
-- client-manager actions. That is the same owner/admin/member set as
-- create_client_with_setup. Viewers can still edit other client fields.
-- Service role bypasses the check. The SQL editor (postgres / supabase_admin
-- with no JWT) bypasses it too. A signed-in session does not, even when the
-- connection user is a superuser.

create or replace function public.protect_client_archive()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() = 'service_role' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if session_user in ('postgres', 'supabase_admin') and auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE'
     or (tg_op = 'UPDATE' and new.status = 'inactive' and old.status is distinct from 'inactive') then
    if not exists (
      select 1
      from public.organization_members
      where organization_id = old.organization_id
        and user_id = auth.uid()
        and role in ('owner', 'admin', 'member')
    ) then
      raise exception 'You cannot delete clients in this organization'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_client_archive() from public, anon, authenticated;

drop trigger if exists protect_client_archive on public.clients;
create trigger protect_client_archive
  before update of status or delete on public.clients
  for each row execute function public.protect_client_archive();
