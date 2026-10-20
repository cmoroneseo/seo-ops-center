-- Migration 111: SEO Plan Basecamp sync state.
--
-- 109 is unused. 108 and 110 are already taken. This file does not rewrite
-- task rows and does not add tasks.updated_at (that column does not exist).
--
-- A plan push records one attempt. basecamp_sync_state is 'ok' or 'failed'.
-- The nightly retry reads the failed partial index. A client-wide failure
-- (revoked OAuth, missing or archived project, rate limit) is one flag on
-- the client so the plan can show a single line instead of a dot per row.
--
-- Both sets of columns are server-controlled, same idea as the Basecamp
-- linkage trigger. The browser can read them. Only service_role (and the
-- migration roles) can write them.
--
-- Operator: run the BEFORE query on production, apply this file, then run
-- AFTER. Do not run it from the app.
--
-- BEFORE
--   select table_name, column_name
--   from information_schema.columns
--   where table_schema = 'public'
--     and (
--       (table_name = 'tasks' and column_name in (
--         'basecamp_sync_state', 'basecamp_sync_error', 'basecamp_sync_attempted_at', 'updated_at'
--       ))
--       or (table_name = 'clients' and column_name in (
--         'basecamp_plan_sync_state', 'basecamp_plan_sync_error'
--       ))
--     )
--   order by table_name, column_name;
--
-- AFTER
--   select table_name, column_name
--   from information_schema.columns
--   where table_schema = 'public'
--     and (
--       (table_name = 'tasks' and column_name in (
--         'basecamp_sync_state', 'basecamp_sync_error', 'basecamp_sync_attempted_at', 'updated_at'
--       ))
--       or (table_name = 'clients' and column_name in (
--         'basecamp_plan_sync_state', 'basecamp_plan_sync_error'
--       ))
--     )
--   order by table_name, column_name;
--
--   select indexname from pg_indexes
--   where schemaname = 'public' and indexname = 'tasks_basecamp_sync_failed_idx';
--
--   select tgname from pg_trigger
--   where not tgisinternal
--     and tgname in ('protect_task_basecamp_sync_state', 'protect_client_basecamp_plan_sync')
--   order by tgname;

alter table public.tasks
  add column if not exists basecamp_sync_state text,
  add column if not exists basecamp_sync_error text,
  add column if not exists basecamp_sync_attempted_at timestamptz;

alter table public.tasks drop constraint if exists tasks_basecamp_sync_state_check;
alter table public.tasks
  add constraint tasks_basecamp_sync_state_check
  check (basecamp_sync_state is null or basecamp_sync_state in ('ok', 'failed'));

create index if not exists tasks_basecamp_sync_failed_idx
  on public.tasks (basecamp_sync_attempted_at, id)
  where basecamp_sync_state = 'failed';

alter table public.clients
  add column if not exists basecamp_plan_sync_state text,
  add column if not exists basecamp_plan_sync_error text;

alter table public.clients drop constraint if exists clients_basecamp_plan_sync_state_check;
alter table public.clients
  add constraint clients_basecamp_plan_sync_state_check
  check (basecamp_plan_sync_state is null or basecamp_plan_sync_state in ('ok', 'failed'));

create or replace function public.protect_task_basecamp_sync_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT'
     and (new.basecamp_sync_state is not null
          or new.basecamp_sync_error is not null
          or new.basecamp_sync_attempted_at is not null) then
    raise exception 'task Basecamp sync state is server-controlled'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and (new.basecamp_sync_state is distinct from old.basecamp_sync_state
          or new.basecamp_sync_error is distinct from old.basecamp_sync_error
          or new.basecamp_sync_attempted_at is distinct from old.basecamp_sync_attempted_at) then
    raise exception 'task Basecamp sync state is server-controlled'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_task_basecamp_sync_state on public.tasks;
create trigger protect_task_basecamp_sync_state
  before insert or update of basecamp_sync_state, basecamp_sync_error, basecamp_sync_attempted_at
  on public.tasks
  for each row execute function public.protect_task_basecamp_sync_state();

create or replace function public.protect_client_basecamp_plan_sync()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT'
     and (new.basecamp_plan_sync_state is not null
          or new.basecamp_plan_sync_error is not null) then
    raise exception 'client Basecamp plan sync state is server-controlled'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and (new.basecamp_plan_sync_state is distinct from old.basecamp_plan_sync_state
          or new.basecamp_plan_sync_error is distinct from old.basecamp_plan_sync_error) then
    raise exception 'client Basecamp plan sync state is server-controlled'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_client_basecamp_plan_sync on public.clients;
create trigger protect_client_basecamp_plan_sync
  before insert or update of basecamp_plan_sync_state, basecamp_plan_sync_error
  on public.clients
  for each row execute function public.protect_client_basecamp_plan_sync();
