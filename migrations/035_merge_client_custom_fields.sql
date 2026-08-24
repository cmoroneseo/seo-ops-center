-- Migration 035: atomic jsonb merge for clients.custom_fields
--
-- The Basecamp timesheet sync route cached the project-timesheet recording id by
-- writing custom_fields = { ...snapshot, basecamp_timesheet_recording_id }. The
-- snapshot was read at getTimeLog time, so any key added concurrently (observed:
-- basecamp_todolist_id) was silently dropped by the full replace.
--
-- This RPC does the write as a single in-database jsonb merge so only the patched
-- keys change and every other custom_fields key is preserved. It is SECURITY
-- DEFINER and called from the service-role admin client, so the migration 031
-- protect_client_basecamp_fields trigger permits the Basecamp key it patches
-- (auth.role() = 'service_role').

create or replace function public.merge_client_custom_fields(
  p_client_id uuid,
  p_organization_id uuid,
  p_patch jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch must be a jsonb object' using errcode = '22004';
  end if;

  update public.clients
     set custom_fields = coalesce(custom_fields, '{}'::jsonb) || p_patch
   where id = p_client_id
     and organization_id = p_organization_id;
end;
$$;

revoke all on function public.merge_client_custom_fields(uuid, uuid, jsonb) from public;
grant execute on function public.merge_client_custom_fields(uuid, uuid, jsonb) to service_role;
