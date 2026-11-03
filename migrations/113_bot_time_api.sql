-- Migration 113: scoped keys for bots that log time in SEO Ops.
--
-- NOT APPLIED. Do not run this against the production Supabase project
-- (sgszojorcftyaknruckh). The owner reviews and applies it separately.
-- Not applied in this change.
--
-- A bot key is a bearer token. Only its SHA-256 hash is stored. The key can
-- create a task, log time, and mark that task done, and nothing else. It is
-- not a Supabase key and it does not open a service-role session for the caller.
-- The server uses the service role only after the hash matches a live key,
-- and only to write those three things.
--
-- Idempotency lives on bot_operations, not on time_logs.operation_id (that
-- column belongs to the planner timer) and not on import_fingerprint (that
-- column is the Basecamp CSV identity and is service-controlled for imports).
-- One bot key plus one idempotency key stores one result. A retry reads it
-- back instead of logging the time, creating the task, or pushing to Basecamp
-- again.
--
-- Bot time stays source = 'seo_pm'. That value means the row was authored in
-- SEO Ops; 'basecamp' is reserved for imported rows and a browser cannot set
-- either one. Which bot wrote the row is time_logs.bot_key_id / tasks.bot_key_id,
-- so bot time can be filtered without overloading activity_key (that column is
-- the timesheet import category).

create table if not exists public.bot_api_keys (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  created_by uuid references public.users(id) on delete set null,
  revoked_at timestamp with time zone,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint bot_api_keys_name_length check (char_length(btrim(name)) between 1 and 40),
  constraint bot_api_keys_hash_sha256 check (key_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists bot_api_keys_hash_unique
  on public.bot_api_keys (key_hash);

create unique index if not exists bot_api_keys_live_name_unique
  on public.bot_api_keys (organization_id, lower(name))
  where revoked_at is null;

create index if not exists bot_api_keys_org_idx
  on public.bot_api_keys (organization_id);

create table if not exists public.bot_operations (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bot_key_id uuid not null references public.bot_api_keys(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  locked_at timestamp with time zone not null default timezone('utc'::text, now()),
  task_id uuid references public.tasks(id) on delete set null,
  time_log_id uuid references public.time_logs(id) on delete set null,
  http_status integer,
  response jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  completed_at timestamp with time zone,
  constraint bot_operations_key_length check (char_length(idempotency_key) between 8 and 200),
  constraint bot_operations_hash_sha256 check (request_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists bot_operations_idempotency_unique
  on public.bot_operations (bot_key_id, idempotency_key);

create index if not exists bot_operations_org_idx
  on public.bot_operations (organization_id, created_at desc);

alter table public.tasks
  add column if not exists bot_key_id uuid references public.bot_api_keys(id) on delete set null;

alter table public.tasks
  add column if not exists bot_operation_id uuid references public.bot_operations(id) on delete set null;

alter table public.time_logs
  add column if not exists bot_key_id uuid references public.bot_api_keys(id) on delete set null;

alter table public.time_logs
  add column if not exists bot_operation_id uuid references public.bot_operations(id) on delete set null;

create unique index if not exists tasks_bot_operation_unique
  on public.tasks (bot_operation_id)
  where bot_operation_id is not null;

create unique index if not exists time_logs_bot_operation_unique
  on public.time_logs (bot_operation_id)
  where bot_operation_id is not null;

create index if not exists tasks_bot_key_idx
  on public.tasks (bot_key_id)
  where bot_key_id is not null;

create index if not exists time_logs_bot_key_idx
  on public.time_logs (bot_key_id)
  where bot_key_id is not null;

-- A signed-in member can insert tasks and time logs. They cannot stamp those
-- rows as bot work, and they cannot clear a stamp the server already wrote.
create or replace function public.protect_bot_attribution()
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
     and (new.bot_key_id is not null or new.bot_operation_id is not null) then
    raise exception 'bot attribution is server-controlled'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and (
       new.bot_key_id is distinct from old.bot_key_id
       or new.bot_operation_id is distinct from old.bot_operation_id
     ) then
    raise exception 'bot attribution is server-controlled'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_task_bot_attribution on public.tasks;
create trigger protect_task_bot_attribution
  before insert or update of bot_key_id, bot_operation_id
  on public.tasks
  for each row execute function public.protect_bot_attribution();

drop trigger if exists protect_time_log_bot_attribution on public.time_logs;
create trigger protect_time_log_bot_attribution
  before insert or update of bot_key_id, bot_operation_id
  on public.time_logs
  for each row execute function public.protect_bot_attribution();

alter table public.bot_api_keys enable row level security;
alter table public.bot_operations enable row level security;

drop policy if exists bot_api_keys_owner_read on public.bot_api_keys;
create policy bot_api_keys_owner_read
  on public.bot_api_keys
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members member
      where member.organization_id = bot_api_keys.organization_id
        and member.user_id = auth.uid()
        and member.role in ('owner', 'admin')
    )
  );

revoke all on table public.bot_api_keys from public, anon, authenticated;
revoke all on table public.bot_operations from public, anon, authenticated;
grant select on table public.bot_api_keys to authenticated;
grant select, insert, update, delete on table public.bot_api_keys to service_role;
grant select, insert, update, delete on table public.bot_operations to service_role;
