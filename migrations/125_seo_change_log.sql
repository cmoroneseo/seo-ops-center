-- Migration 125: SEO change log.
--
-- NOT APPLIED. Do not run this against the production Supabase project
-- (sgszojorcftyaknruckh). The owner reviews and applies it separately.
-- Not applied in this change.
--
-- Four tables for a staff log of SEO changes and the baseline captured when
-- the change was logged. Later checkpoints are computed on read from
-- gsc_history_* and ga4_*. This file does not insert rows, does not start a
-- sync, and does not call an external API.

create table if not exists public.seo_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  change_type text not null check (change_type in (
    'title', 'h1', 'meta', 'content_refresh', 'internal_links', 'schema',
    'new_page', 'redirect', 'cro_block', 'other'
  )),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  before_text text not null default '' check (char_length(before_text) <= 4000),
  after_text text not null default '' check (char_length(after_text) <= 4000),
  live_at timestamptz not null,
  approved_by_name text not null check (char_length(btrim(approved_by_name)) between 1 and 120),
  approved_at timestamptz,
  backup_reference text not null default '' check (char_length(backup_reference) <= 500),
  revert_instructions text not null default '' check (char_length(revert_instructions) <= 2000),
  kpi text not null check (kpi in (
    'clicks', 'impressions', 'ctr', 'avg_position', 'organic_sessions', 'key_events'
  )),
  compare_last_year boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seo_changes_client_live_idx
  on public.seo_changes (organization_id, client_id, live_at desc);

comment on table public.seo_changes is
  'Staff log of an SEO change. Impact is computed on read. Not applied until the owner runs this file.';

create table if not exists public.seo_change_pages (
  id uuid primary key default gen_random_uuid(),
  change_id uuid not null references public.seo_changes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  url text not null check (char_length(btrim(url)) between 1 and 2000),
  url_key text not null check (char_length(url_key) between 1 and 2000),
  label text not null default '' check (char_length(label) <= 160),
  cms_page_id text check (cms_page_id is null or char_length(cms_page_id) <= 80),
  cms_widget_id text check (cms_widget_id is null or char_length(cms_widget_id) <= 80),
  unique (change_id, url_key)
);

create index if not exists seo_change_pages_client_idx
  on public.seo_change_pages (organization_id, client_id);

create table if not exists public.seo_change_queries (
  id uuid primary key default gen_random_uuid(),
  change_id uuid not null references public.seo_changes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  query text not null check (char_length(btrim(query)) between 1 and 200),
  normalized_query text not null check (char_length(normalized_query) between 1 and 200),
  unique (change_id, normalized_query)
);

create table if not exists public.seo_change_baselines (
  change_id uuid primary key references public.seo_changes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  captured_at timestamptz not null,
  data_through date,
  gsc_lag_days integer not null default 3 check (gsc_lag_days >= 0 and gsc_lag_days <= 14),
  status text not null check (status in ('captured', 'partial', 'missing')),
  low_data boolean not null default false,
  estimate boolean not null default false,
  gsc_connected boolean not null default false,
  ga4_connected boolean not null default false,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  note text not null default '' check (char_length(note) <= 500)
);

create or replace function public.guard_seo_change_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.clients
    where id = new.client_id and organization_id = new.organization_id
  ) then
    raise exception 'Client does not belong to this organization' using errcode = '23514';
  end if;
  if tg_table_name <> 'seo_changes' then
    if not exists (
      select 1 from public.seo_changes
      where id = new.change_id
        and organization_id = new.organization_id
        and client_id = new.client_id
    ) then
      raise exception 'Change log row does not match its change' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.client_id is distinct from old.client_id
  ) then
    raise exception 'Change log rows stay on their client' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_seo_change_scope() from public, anon;
grant execute on function public.guard_seo_change_scope() to authenticated, service_role;

drop trigger if exists seo_changes_scope on public.seo_changes;
create trigger seo_changes_scope
  before insert or update on public.seo_changes
  for each row execute function public.guard_seo_change_scope();

drop trigger if exists seo_change_pages_scope on public.seo_change_pages;
create trigger seo_change_pages_scope
  before insert or update on public.seo_change_pages
  for each row execute function public.guard_seo_change_scope();

drop trigger if exists seo_change_queries_scope on public.seo_change_queries;
create trigger seo_change_queries_scope
  before insert or update on public.seo_change_queries
  for each row execute function public.guard_seo_change_scope();

drop trigger if exists seo_change_baselines_scope on public.seo_change_baselines;
create trigger seo_change_baselines_scope
  before insert or update on public.seo_change_baselines
  for each row execute function public.guard_seo_change_scope();

alter table public.seo_changes enable row level security;
alter table public.seo_change_pages enable row level security;
alter table public.seo_change_queries enable row level security;
alter table public.seo_change_baselines enable row level security;

drop policy if exists seo_changes_org on public.seo_changes;
create policy seo_changes_org on public.seo_changes
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

drop policy if exists seo_change_pages_org on public.seo_change_pages;
create policy seo_change_pages_org on public.seo_change_pages
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

drop policy if exists seo_change_queries_org on public.seo_change_queries;
create policy seo_change_queries_org on public.seo_change_queries
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

drop policy if exists seo_change_baselines_org on public.seo_change_baselines;
create policy seo_change_baselines_org on public.seo_change_baselines
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

revoke all on public.seo_changes, public.seo_change_pages, public.seo_change_queries, public.seo_change_baselines
  from public, anon, authenticated;
grant select, insert, update, delete on public.seo_changes, public.seo_change_pages, public.seo_change_queries, public.seo_change_baselines
  to authenticated;
grant all on public.seo_changes, public.seo_change_pages, public.seo_change_queries, public.seo_change_baselines
  to service_role;
