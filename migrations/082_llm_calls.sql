-- 082: audited LLM calls and a per-org monthly spend cap.
-- 075 is reserved and unused. 081 is the weekly digest.
--
-- llm_calls is the ledger for model calls made through lib/llm.
-- It stores model, token counts, cost, latency, and status.
-- It does not store prompts, completions, or credentials.
--
-- organizations.llm_monthly_spend_cap_usd defaults to $50.
-- Owners can change it through the existing organization update policy.
-- The app warns at 80% and refuses a new call at 100%.
-- The cost is absorbed by the agency. Nothing here bills a client.
--
-- Writes are service-role only. Org members can read their own rows.
-- Apply this file in the Supabase SQL editor before turning on
-- CONTENT_WRITER_LLM_ENABLED. This migration is not applied by the app.
--
-- Rollback:
-- drop trigger if exists llm_calls_belong on public.llm_calls;
-- drop function if exists public.llm_calls_belong();
-- drop function if exists public.llm_month_spend_usd(uuid, timestamptz, timestamptz);
-- drop table if exists public.llm_calls;
-- alter table public.organizations drop column if exists llm_monthly_spend_cap_usd;

alter table public.organizations
  add column if not exists llm_monthly_spend_cap_usd numeric(12, 2) not null default 50
  check (llm_monthly_spend_cap_usd >= 0);

comment on column public.organizations.llm_monthly_spend_cap_usd is
  'Monthly AI spend cap in USD. Default $50. The app warns at 80% and hard-stops at 100%. Cost is absorbed, not billed through.';

create table public.llm_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  feature text not null check (feature ~ '^[a-z][a-z0-9_.]{0,63}$'),
  ref_id text check (ref_id is null or ref_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(16, 8) not null default 0 check (cost_usd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  status text not null check (status in ('succeeded', 'failed', 'blocked')),
  error text check (error is null or error ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  constraint llm_calls_shape check (
    (
      status = 'blocked'
      and cost_usd = 0
      and input_tokens = 0
      and output_tokens = 0
      and latency_ms is null
      and error = 'monthly_spend_cap'
    )
    or (status = 'failed' and error is not null)
    or (status = 'succeeded' and error is null and latency_ms is not null)
  )
);

comment on table public.llm_calls is
  'One row per audited model call. Prompts and completions are not stored.';

create index llm_calls_org_created_idx
  on public.llm_calls (organization_id, created_at desc);

alter table public.llm_calls enable row level security;

create policy llm_calls_select
  on public.llm_calls
  for select
  to authenticated
  using (organization_id in (select public.get_user_org_ids()));

revoke all on table public.llm_calls from public, anon, authenticated;
grant select on table public.llm_calls to authenticated;
grant all on table public.llm_calls to service_role;

create or replace function public.llm_calls_belong()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.client_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.clients c
    where c.id = new.client_id
      and c.organization_id = new.organization_id
  ) then
    raise exception 'llm_calls.client_id is not in this organization'
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists llm_calls_belong on public.llm_calls;
create trigger llm_calls_belong
  before insert or update on public.llm_calls
  for each row
  execute function public.llm_calls_belong();

create or replace function public.llm_month_spend_usd(
  p_organization_id uuid,
  p_month_start timestamptz,
  p_month_end timestamptz
)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)
  from public.llm_calls
  where organization_id = p_organization_id
    and created_at >= p_month_start
    and created_at < p_month_end
    and status in ('succeeded', 'failed');
$$;

revoke all on function public.llm_month_spend_usd(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.llm_month_spend_usd(uuid, timestamptz, timestamptz) to service_role;
