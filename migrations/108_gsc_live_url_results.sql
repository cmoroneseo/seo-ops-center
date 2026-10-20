-- Migration 108: Search Console rows for live task and deliverable URLs.
-- The property-wide history tables stay as they are. These tables hold only
-- the pages that have shipped, so a result can be read without scanning them.
-- The daily GSC sync writes them. Members can read their own organization.
-- Idempotent. Do not apply from this branch; apply with the other migrations.

create table if not exists public.gsc_live_url_days (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  property text not null check (length(property) > 0),
  url_key text not null check (length(url_key) > 0 and length(url_key) <= 2000),
  data_date date not null,
  clicks bigint not null check (clicks >= 0),
  impressions bigint not null check (impressions >= 0),
  position double precision not null check (position >= 0 and position < 'Infinity'::float8),
  fetched_at timestamptz not null,
  primary key (client_id, property, url_key, data_date)
);

create index if not exists gsc_live_url_days_org_idx
  on public.gsc_live_url_days (organization_id, client_id);

create table if not exists public.gsc_live_url_queries (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  property text not null check (length(property) > 0),
  url_key text not null check (length(url_key) > 0 and length(url_key) <= 2000),
  query text not null check (length(query) > 0 and length(query) <= 500),
  clicks bigint not null check (clicks >= 0),
  impressions bigint not null check (impressions >= 0),
  position double precision not null check (position >= 0 and position < 'Infinity'::float8),
  window_start date not null,
  window_end date not null,
  fetched_at timestamptz not null,
  primary key (client_id, property, url_key, query)
);

create index if not exists gsc_live_url_queries_org_idx
  on public.gsc_live_url_queries (organization_id, client_id);

create table if not exists public.gsc_live_url_checks (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  property text not null check (length(property) > 0),
  url_key text not null check (length(url_key) > 0 and length(url_key) <= 2000),
  go_live date not null,
  coverage_start date not null,
  coverage_end date not null,
  query_window_start date not null,
  query_window_end date not null,
  has_rows boolean not null,
  fetched_at timestamptz not null,
  primary key (client_id, property, url_key)
);

create index if not exists gsc_live_url_checks_org_idx
  on public.gsc_live_url_checks (organization_id, client_id);

alter table public.gsc_live_url_days enable row level security;
alter table public.gsc_live_url_queries enable row level security;
alter table public.gsc_live_url_checks enable row level security;

drop policy if exists gsc_live_url_days_read on public.gsc_live_url_days;
create policy gsc_live_url_days_read on public.gsc_live_url_days
  for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

drop policy if exists gsc_live_url_queries_read on public.gsc_live_url_queries;
create policy gsc_live_url_queries_read on public.gsc_live_url_queries
  for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

drop policy if exists gsc_live_url_checks_read on public.gsc_live_url_checks;
create policy gsc_live_url_checks_read on public.gsc_live_url_checks
  for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

revoke all on public.gsc_live_url_days, public.gsc_live_url_queries, public.gsc_live_url_checks from anon, authenticated;
grant select on public.gsc_live_url_days, public.gsc_live_url_queries, public.gsc_live_url_checks to authenticated;
grant all on public.gsc_live_url_days, public.gsc_live_url_queries, public.gsc_live_url_checks to service_role;

create or replace function public.replace_gsc_live_url(
  p_organization_id uuid,
  p_client_id uuid,
  p_property text,
  p_url_key text,
  p_go_live date,
  p_coverage_start date,
  p_coverage_end date,
  p_query_window_start date,
  p_query_window_end date,
  p_fetched_at timestamptz,
  p_days jsonb,
  p_queries jsonb
) returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_has_rows boolean;
begin
  if p_property is null or length(p_property) = 0 or p_url_key is null or length(p_url_key) = 0 or length(p_url_key) > 2000 then
    raise exception 'Invalid live URL';
  end if;
  if p_coverage_start is null or p_coverage_end is null or p_coverage_start > p_coverage_end
     or p_query_window_start is null or p_query_window_end is null or p_query_window_start > p_query_window_end
     or p_go_live is null then
    raise exception 'Invalid live URL window';
  end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) > 500
     or p_queries is null or jsonb_typeof(p_queries) <> 'array' or jsonb_array_length(p_queries) > 8 then
    raise exception 'Invalid live URL batch';
  end if;
  perform 1 from public.clients where id = p_client_id and organization_id = p_organization_id;
  if not found then raise exception 'Client organization mismatch'; end if;
  perform 1 from public.client_integrations
    where client_id = p_client_id
      and organization_id = p_organization_id
      and service = 'gsc'
      and sync_status in ('active', 'error')
      and credentials->>'site_url' = p_property;
  if not found then raise exception 'GSC property changed; restart import'; end if;

  delete from public.gsc_live_url_days
    where client_id = p_client_id and property = p_property and url_key = p_url_key;
  delete from public.gsc_live_url_queries
    where client_id = p_client_id and property = p_property and url_key = p_url_key;

  insert into public.gsc_live_url_days(
    organization_id, client_id, property, url_key, data_date, clicks, impressions, position, fetched_at
  )
  select
    p_organization_id, p_client_id, p_property, p_url_key,
    x.data_date, x.clicks, x.impressions, x.position, p_fetched_at
  from jsonb_to_recordset(p_days) as x(
    data_date date, clicks bigint, impressions bigint, position double precision
  );

  insert into public.gsc_live_url_queries(
    organization_id, client_id, property, url_key, query, clicks, impressions, position,
    window_start, window_end, fetched_at
  )
  select
    p_organization_id, p_client_id, p_property, p_url_key,
    x.query, x.clicks, x.impressions, x.position,
    p_query_window_start, p_query_window_end, p_fetched_at
  from jsonb_to_recordset(p_queries) as x(
    query text, clicks bigint, impressions bigint, position double precision
  );

  v_has_rows := jsonb_array_length(p_days) > 0 or jsonb_array_length(p_queries) > 0;
  insert into public.gsc_live_url_checks(
    organization_id, client_id, property, url_key, go_live,
    coverage_start, coverage_end, query_window_start, query_window_end,
    has_rows, fetched_at
  ) values (
    p_organization_id, p_client_id, p_property, p_url_key, p_go_live,
    p_coverage_start, p_coverage_end, p_query_window_start, p_query_window_end,
    v_has_rows, p_fetched_at
  )
  on conflict (client_id, property, url_key) do update set
    organization_id = excluded.organization_id,
    go_live = excluded.go_live,
    coverage_start = excluded.coverage_start,
    coverage_end = excluded.coverage_end,
    query_window_start = excluded.query_window_start,
    query_window_end = excluded.query_window_end,
    has_rows = excluded.has_rows,
    fetched_at = excluded.fetched_at;
end;
$$;

revoke all on function public.replace_gsc_live_url(uuid, uuid, text, text, date, date, date, date, date, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_gsc_live_url(uuid, uuid, text, text, date, date, date, date, date, timestamptz, jsonb, jsonb) to service_role;
