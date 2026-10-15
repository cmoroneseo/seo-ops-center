-- 100: Read-only bot API tokens and audit. Not applied in this change.
--
-- Apply after 099. New tables only. This file does not alter
-- client_integrations, ga4_*, gsc_*, or any existing row.
--
-- Plaintext bot tokens are never stored. token_prefix is the lookup id and
-- token_hash is SHA-256 of the full bearer. Owners and admins can read
-- metadata. token_hash is not granted to authenticated. Inserts, revocation,
-- quota, and audit writes are service_role only, after the API has checked
-- the caller.
--
-- Google refresh tokens are not in this migration. They are sealed in
-- application code inside client_integrations.credentials.

create table public.bot_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null,
  client_ids uuid[] not null default '{}',
  scopes text[] not null default '{ga4.read,gsc.read}',
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  rate_limit_per_minute integer not null default 60,
  window_started_at timestamptz,
  window_count integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (char_length(btrim(name)) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  check (token_prefix ~ '^[A-Za-z0-9_-]{8,32}$'),
  check (token_hash ~ '^[a-f0-9]{64}$'),
  check (cardinality(client_ids) <= 100),
  check (cardinality(scopes) between 1 and 2 and scopes <@ array['ga4.read', 'gsc.read']::text[]),
  check (rate_limit_per_minute between 1 and 600),
  check (window_count >= 0),
  check (expires_at is null or expires_at > created_at),
  unique (token_prefix),
  unique (token_hash)
);

create index bot_tokens_org_idx on public.bot_tokens (organization_id, created_at desc);

create table public.bot_api_audit (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  token_id uuid references public.bot_tokens(id) on delete set null,
  token_prefix text,
  route text not null,
  client_id uuid,
  status integer not null,
  error_code text,
  created_at timestamptz not null default now(),
  check (route in ('ga4', 'gsc')),
  check (status between 100 and 599),
  check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  check (token_prefix is null or token_prefix ~ '^[A-Za-z0-9_-]{8,32}$')
);

create index bot_api_audit_token_idx on public.bot_api_audit (token_id, created_at desc);
create index bot_api_audit_org_idx on public.bot_api_audit (organization_id, created_at desc);

alter table public.bot_tokens enable row level security;
alter table public.bot_api_audit enable row level security;

create policy bot_tokens_admin_read on public.bot_tokens
  for select to authenticated
  using (organization_id in (select public.get_user_admin_org_ids()));

create policy bot_api_audit_admin_read on public.bot_api_audit
  for select to authenticated
  using (organization_id in (select public.get_user_admin_org_ids()));

create function public.bot_tokens_clients_in_org()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from unnest(new.client_ids) as cid
    where not exists (
      select 1 from public.clients c
      where c.id = cid and c.organization_id = new.organization_id
    )
  ) then
    raise exception 'bot token client is outside the organization';
  end if;
  return new;
end;
$$;

create trigger bot_tokens_clients_in_org
  before insert or update of client_ids, organization_id on public.bot_tokens
  for each row execute function public.bot_tokens_clients_in_org();

-- Fixed one-minute window. A denied call does not increment the counter.
-- Revoked and expired tokens are inactive and do not consume quota.
create function public.consume_bot_token_quota(p_token_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_row public.bot_tokens%rowtype;
  v_started timestamptz;
  v_count integer;
  v_allowed boolean;
  v_retry integer;
begin
  select * into v_row from public.bot_tokens where id = p_token_id for update;
  if not found then
    return jsonb_build_object('allowed', false, 'inactive', true, 'limit', 0, 'remaining', 0, 'retry_after_seconds', 0);
  end if;
  if v_row.revoked_at is not null or (v_row.expires_at is not null and v_row.expires_at <= p_now) then
    return jsonb_build_object('allowed', false, 'inactive', true, 'limit', v_row.rate_limit_per_minute, 'remaining', 0, 'retry_after_seconds', 0);
  end if;
  if v_row.window_started_at is null or p_now >= v_row.window_started_at + interval '1 minute' then
    v_started := p_now;
    v_count := 1;
    v_allowed := true;
  elsif v_row.window_count >= v_row.rate_limit_per_minute then
    v_started := v_row.window_started_at;
    v_count := v_row.window_count;
    v_allowed := false;
  else
    v_started := v_row.window_started_at;
    v_count := v_row.window_count + 1;
    v_allowed := true;
  end if;
  v_retry := greatest(1, ceil(extract(epoch from (v_started + interval '1 minute' - p_now)))::integer);
  update public.bot_tokens
    set window_started_at = v_started,
        window_count = v_count,
        last_used_at = p_now
    where id = p_token_id;
  return jsonb_build_object(
    'allowed', v_allowed,
    'inactive', false,
    'limit', v_row.rate_limit_per_minute,
    'remaining', greatest(0, v_row.rate_limit_per_minute - v_count),
    'retry_after_seconds', case when v_allowed then 0 else v_retry end
  );
end;
$$;

revoke all on public.bot_tokens, public.bot_api_audit from public, anon, authenticated;
revoke all on function public.bot_tokens_clients_in_org() from public, anon, authenticated;
revoke all on function public.consume_bot_token_quota(uuid, timestamptz) from public, anon, authenticated;

grant select (
  id, organization_id, name, token_prefix, client_ids, scopes,
  expires_at, revoked_at, last_used_at, rate_limit_per_minute, created_by, created_at
) on public.bot_tokens to authenticated;
grant select on public.bot_api_audit to authenticated;
grant all on public.bot_tokens, public.bot_api_audit to service_role;
grant usage, select on sequence public.bot_api_audit_id_seq to service_role;
grant execute on function public.bot_tokens_clients_in_org() to service_role;
grant execute on function public.consume_bot_token_quota(uuid, timestamptz) to service_role;
