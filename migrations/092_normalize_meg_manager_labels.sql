-- 092: Point MEG's "Abel" and "Carlos" labels at the one real profile each.
-- 089 stays reserved for the Basecamp projection (list, prefix, group).
-- Not applied in this change.
--
-- Read-only check on 2026-10-14 against project sgszojorcftyaknruckh:
-- auth.users and public.users each contain exactly one Abel Miranda and one
-- Carlos Morones. There is no second id to merge, disable, or delete.
-- Deleting either id would remove that person's time logs, planner, and
-- (for Carlos) ownership of Marketing Empire Group and the sandbox org.
--
-- What looks like a duplicate is stored text:
--   clients.account_manager_name = 'Abel'           with a null id     (32 MEG clients)
--   clients.account_manager_name = 'Abel Miranda'   with Abel's id     (4)
--   clients.account_manager_name = 'Carlos'         with Carlos's id   (27)
--   clients.account_manager_name = 'Carlos Morones' with Carlos's id   (3)
--   team_bonus.member_name = 'Abel'                 with a null user   (1 MEG row)
--   team_bonus.member_name = 'Carlos'               with Carlos's id   (1 MEG row)
--
-- Canonical profiles, both already MEG members:
--   Abel Miranda   c8219b94-acfe-400a-881e-ab56b7266644  amiranda@marketingempiregroup.com
--   Carlos Morones 360c97ac-54fc-41fb-b660-0566d63c2e1b  cmorones@marketingempiregroup.com
--
-- This migration relinks those labels. It does not delete a user. If a second
-- Abel or Carlos profile exists when it runs, it raises and changes nothing.
-- A database with neither person (a fresh schema load) is left alone.
-- Historical activity-log names are already the full names and are not rewritten.
-- Sandbox clients that use Carlos's id under another label (Jordan Ellis) are not touched.

begin;

do $guard$
declare
  v_abel uuid := 'c8219b94-acfe-400a-881e-ab56b7266644';
  v_carlos uuid := '360c97ac-54fc-41fb-b660-0566d63c2e1b';
  v_meg uuid := '51f63cc5-4c52-45ed-bb20-2d5ce6320bf2';
  v_abel_auth integer;
  v_carlos_auth integer;
begin
  select count(*) into v_abel_auth
  from auth.users
  where id = v_abel or lower(email) = 'amiranda@marketingempiregroup.com';

  select count(*) into v_carlos_auth
  from auth.users
  where id = v_carlos or lower(email) = 'cmorones@marketingempiregroup.com';

  if v_abel_auth = 0 and v_carlos_auth = 0
     and not exists (select 1 from public.users where id in (v_abel, v_carlos)) then
    return;
  end if;

  if v_abel_auth <> 1 or v_carlos_auth <> 1 then
    raise exception 'Refusing manager label cleanup: expected one auth user for each person';
  end if;

  if not exists (
       select 1 from auth.users
       where id = v_abel and lower(email) = 'amiranda@marketingempiregroup.com'
     )
     or not exists (
       select 1 from auth.users
       where id = v_carlos and lower(email) = 'cmorones@marketingempiregroup.com'
     )
     or not exists (
       select 1 from public.users
       where id = v_abel
         and lower(email) = 'amiranda@marketingempiregroup.com'
         and full_name = 'Abel Miranda'
     )
     or not exists (
       select 1 from public.users
       where id = v_carlos
         and lower(email) = 'cmorones@marketingempiregroup.com'
         and full_name = 'Carlos Morones'
     ) then
    raise exception 'Refusing manager label cleanup: canonical profile does not match';
  end if;

  if exists (
       select 1 from public.users
       where id not in (v_abel, v_carlos)
         and (
           lower(btrim(full_name)) in ('abel', 'abel miranda', 'carlos', 'carlos morones')
           or lower(btrim(email)) in ('amiranda@marketingempiregroup.com', 'cmorones@marketingempiregroup.com')
         )
     )
     or exists (
       select 1 from auth.users
       where id not in (v_abel, v_carlos)
         and (
           lower(btrim(email)) in ('amiranda@marketingempiregroup.com', 'cmorones@marketingempiregroup.com')
           or lower(btrim(coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', '')))
              in ('abel', 'abel miranda', 'carlos', 'carlos morones')
         )
     ) then
    raise exception 'Refusing manager label cleanup: a second Abel or Carlos profile exists. Merge that id explicitly; this migration will not delete a user.';
  end if;

  if not exists (
       select 1 from public.organization_members
       where organization_id = v_meg and user_id = v_abel
     )
     or not exists (
       select 1 from public.organization_members
       where organization_id = v_meg and user_id = v_carlos
     ) then
    raise exception 'Refusing manager label cleanup: canonical user is not a MEG member';
  end if;

  if exists (
       select 1 from public.clients
       where organization_id = v_meg
         and lower(btrim(account_manager_name)) in ('abel', 'carlos')
         and account_manager_id is not null
         and account_manager_id not in (v_abel, v_carlos)
     ) then
    raise exception 'Refusing manager label cleanup: a short manager name already points at a different user';
  end if;

  update public.clients
  set account_manager_id = v_abel,
      account_manager_name = 'Abel Miranda'
  where organization_id = v_meg
    and account_manager_id is null
    and lower(btrim(account_manager_name)) = 'abel';

  update public.clients
  set account_manager_name = 'Abel Miranda'
  where organization_id = v_meg
    and account_manager_id = v_abel
    and account_manager_name is distinct from 'Abel Miranda';

  update public.clients
  set account_manager_name = 'Carlos Morones'
  where organization_id = v_meg
    and account_manager_id = v_carlos
    and lower(btrim(account_manager_name)) = 'carlos';

  update public.team_bonus
  set user_id = v_abel,
      member_name = 'Abel Miranda'
  where organization_id = v_meg
    and user_id is null
    and lower(btrim(member_name)) = 'abel';

  update public.team_bonus
  set member_name = 'Carlos Morones'
  where organization_id = v_meg
    and user_id = v_carlos
    and lower(btrim(member_name)) = 'carlos';
end
$guard$;

commit;
