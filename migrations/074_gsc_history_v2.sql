-- 074: GSC history v2 columns. Safe to apply on Supabase Free before any v2 ingest.
--
-- Storage (measured Oct 9, 2026, before this migration):
--   gsc_history_facts is ~372 MB (231 MB heap + 141 MB indexes, ~1.06M rows).
--   Adding nullable device/country and surface text NOT NULL DEFAULT 'organic'
--   is metadata-only on Postgres 11+ and does not rewrite the heap.
--   Replacing the grain checks scans the heap and does not rewrite it.
--   The surface backfill updates only rows whose page contains utm_medium=gbp
--   (~30,287 rows), in primary-key ranges, so the other ~1.03M rows are not
--   rewritten. Those updates are about 7–15 MB of new tuples until autovacuum.
--   No new indexes. gsc_sync_jobs has 7 rows. metrics has 36 rows.
--
-- Flags stay off in production. This file does not enqueue work or insert grains.
-- Do not drop the new fact columns on Free: dropping a column rewrites the heap.

alter table public.gsc_history_facts
  add column if not exists device text,
  add column if not exists country text,
  add column if not exists surface text not null default 'organic';

alter table public.gsc_history_facts drop constraint if exists gsc_history_facts_grain_check;
alter table public.gsc_history_facts add constraint gsc_history_facts_grain_check
  check (grain in ('property','page','query_page','property_device','page_device','property_country','page_organic'));

alter table public.gsc_history_facts drop constraint if exists gsc_history_facts_surface_check;
alter table public.gsc_history_facts add constraint gsc_history_facts_surface_check
  check (surface in ('organic','gbp_link'));

alter table public.gsc_history_facts drop constraint if exists gsc_history_facts_device_check;
alter table public.gsc_history_facts add constraint gsc_history_facts_device_check
  check (device is null or device in ('DESKTOP','MOBILE','TABLET'));

alter table public.gsc_history_facts drop constraint if exists gsc_history_facts_check;
alter table public.gsc_history_facts add constraint gsc_history_facts_check check (
  (grain='property' and page='' and query='' and device is null and country is null)
  or (grain='page' and page<>'' and query='' and device is null and country is null)
  or (grain='query_page' and page<>'' and query<>'' and device is null and country is null)
  or (grain='property_device' and page='' and device in ('DESKTOP','MOBILE','TABLET') and query=device and country is null)
  or (grain='page_device' and page<>'' and device in ('DESKTOP','MOBILE','TABLET') and query=device and country is null)
  or (grain='property_country' and page='' and country ~ '^[a-z]{3}$' and query=country and device is null)
  or (grain='page_organic' and page<>'' and query='' and device is null and country is null and surface='organic')
);

-- Rewrites only the matching id slice. The legacy unique key stays
-- (day_id, grain, row_key); device and country grains copy that value into
-- query so a second full-table unique index is not required.
create or replace function public.backfill_gsc_history_surface(p_from bigint, p_to bigint)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 100000 then
    raise exception 'surface backfill range must be a positive span of at most 100000 ids';
  end if;
  update public.gsc_history_facts
  set surface = 'gbp_link'
  where id >= p_from
    and id < p_to
    and surface = 'organic'
    and (
      page ilike '%utm_medium=gbp%'
      or page ilike '%utm_medium%3dgbp%'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.backfill_gsc_history_surface(bigint, bigint) from public, anon, authenticated;
grant execute on function public.backfill_gsc_history_surface(bigint, bigint) to service_role;

do $$
declare
  v_min bigint;
  v_max bigint;
  v_lo bigint;
  v_span bigint := 100000;
begin
  select min(id), max(id) into v_min, v_max from public.gsc_history_facts;
  if v_min is null then
    return;
  end if;
  v_lo := v_min;
  while v_lo <= v_max loop
    perform public.backfill_gsc_history_surface(v_lo, v_lo + v_span);
    v_lo := v_lo + v_span;
  end loop;
end $$;

-- Same arguments as 067 so the deployed worker keeps saving v1 days before
-- the v2 flag is turned on. Device, country, and surface travel inside p_facts.
create or replace function public.replace_gsc_history_day(
  p_organization_id uuid,
  p_client_id uuid,
  p_property text,
  p_date date,
  p_fetched_at timestamptz,
  p_page_limited boolean,
  p_query_limited boolean,
  p_facts jsonb,
  p_is_incomplete boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_previous timestamptz;
begin
  if p_date > (now() at time zone 'America/Los_Angeles')::date then
    raise exception 'History cannot include future Pacific dates';
  end if;
  -- v1 days stay under 10001. A v2 day adds device, country, and page-level
  -- organic rows and can reach about 20014 facts.
  if p_facts is null or jsonb_typeof(p_facts) <> 'array' or jsonb_array_length(p_facts) > 25000 then
    raise exception 'Invalid history batch';
  end if;
  perform 1 from public.clients where id = p_client_id and organization_id = p_organization_id;
  if not found then raise exception 'Client organization mismatch'; end if;
  perform 1 from public.client_integrations
  where client_id = p_client_id
    and organization_id = p_organization_id
    and service = 'gsc'
    and sync_status in ('active','error')
    and credentials->>'site_url' = p_property
  for update;
  if not found then raise exception 'GSC property changed; restart import'; end if;
  select id, fetched_at into v_id, v_previous
  from public.gsc_history_days
  where client_id = p_client_id and property = p_property and data_date = p_date and search_type = 'web'
  for update;
  if found and v_previous > p_fetched_at then return false; end if;
  if v_id is null then
    insert into public.gsc_history_days(
      organization_id, client_id, property, data_date, fetched_at, page_limited, query_limited, is_incomplete
    ) values (
      p_organization_id, p_client_id, p_property, p_date, p_fetched_at, p_page_limited, p_query_limited, p_is_incomplete
    ) returning id into v_id;
  else
    update public.gsc_history_days
    set fetched_at = p_fetched_at,
        imported_at = now(),
        page_limited = p_page_limited,
        query_limited = p_query_limited,
        is_incomplete = p_is_incomplete
    where id = v_id;
    delete from public.gsc_history_facts where day_id = v_id;
  end if;
  insert into public.gsc_history_facts(day_id, grain, page, query, clicks, impressions, position, device, country, surface)
  select
    v_id,
    x.grain,
    coalesce(x.page, ''),
    case
      when x.grain in ('property_device','page_device') then x.device
      when x.grain = 'property_country' then lower(x.country)
      else coalesce(x.query, '')
    end,
    x.clicks,
    x.impressions,
    x.position,
    case when x.grain in ('property_device','page_device') then x.device else null end,
    case when x.grain = 'property_country' then lower(x.country) else null end,
    case
      when x.grain = 'page_organic' then 'organic'
      when x.surface in ('organic','gbp_link') then x.surface
      when coalesce(x.page, '') ilike '%utm_medium=gbp%' or coalesce(x.page, '') ilike '%utm_medium%3dgbp%' then 'gbp_link'
      else 'organic'
    end
  from jsonb_to_recordset(p_facts) as x(
    grain text,
    page text,
    query text,
    clicks bigint,
    impressions bigint,
    position double precision,
    device text,
    country text,
    surface text
  );
  return true;
end;
$$;

revoke all on function public.replace_gsc_history_day(uuid, uuid, text, date, timestamptz, boolean, boolean, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.replace_gsc_history_day(uuid, uuid, text, date, timestamptz, boolean, boolean, jsonb, boolean) to service_role;

alter table public.gsc_sync_jobs
  add column if not exists kind text not null default 'daily',
  add column if not exists grain_set text not null default 'v1',
  add column if not exists cursor_date date;

alter table public.gsc_sync_jobs drop constraint if exists gsc_sync_jobs_kind_check;
alter table public.gsc_sync_jobs add constraint gsc_sync_jobs_kind_check
  check (kind in ('daily','v2_backfill'));

alter table public.gsc_sync_jobs drop constraint if exists gsc_sync_jobs_grain_set_check;
alter table public.gsc_sync_jobs add constraint gsc_sync_jobs_grain_set_check
  check (grain_set in ('v1','v2'));

alter table public.gsc_sync_jobs drop constraint if exists gsc_sync_jobs_client_id_property_key;
alter table public.gsc_sync_jobs drop constraint if exists gsc_sync_jobs_client_property_kind_key;
alter table public.gsc_sync_jobs
  add constraint gsc_sync_jobs_client_property_kind_key unique (client_id, property, kind);

create or replace function public.enqueue_gsc_sync(p_organization_id uuid, p_client_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_property text;
begin
  select i.credentials->>'site_url' into v_property
  from public.client_integrations i
  join public.clients c on c.id = i.client_id and c.organization_id = i.organization_id
  where i.organization_id = p_organization_id
    and i.client_id = p_client_id
    and i.service = 'gsc'
    and i.sync_status in ('active','error')
    and length(i.credentials->>'site_url') > 0;
  if v_property is null then return false; end if;
  insert into public.gsc_sync_jobs(organization_id, client_id, property, kind, grain_set)
  values (p_organization_id, p_client_id, v_property, 'daily', 'v1')
  on conflict (client_id, property, kind) do update
    set status = 'pending', available_at = now()
    where gsc_sync_jobs.status = 'idle' and gsc_sync_jobs.available_at <= now();
  return true;
end;
$$;

-- One historical pass per property. A finished job (cursor on the oldest day
-- of the 486-day window) is not woken again. cursor_date is the last saved
-- day, so a retry keeps walking older days instead of starting over.
create or replace function public.enqueue_gsc_v2_backfill(p_organization_id uuid, p_client_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_property text;
begin
  select i.credentials->>'site_url' into v_property
  from public.client_integrations i
  join public.clients c on c.id = i.client_id and c.organization_id = i.organization_id
  where i.organization_id = p_organization_id
    and i.client_id = p_client_id
    and i.service = 'gsc'
    and i.sync_status in ('active','error')
    and length(i.credentials->>'site_url') > 0;
  if v_property is null then return false; end if;
  insert into public.gsc_sync_jobs(organization_id, client_id, property, kind, grain_set)
  values (p_organization_id, p_client_id, v_property, 'v2_backfill', 'v2')
  on conflict (client_id, property, kind) do update
    set status = 'pending', available_at = now()
    where gsc_sync_jobs.status = 'idle'
      and gsc_sync_jobs.available_at <= now()
      and gsc_sync_jobs.cursor_date is not null
      and gsc_sync_jobs.cursor_date > ((now() at time zone 'America/Los_Angeles')::date - 485);
  return true;
end;
$$;

drop function if exists public.claim_gsc_sync(uuid);
create function public.claim_gsc_sync(p_client_id uuid default null, p_kind text default 'daily')
returns setof public.gsc_sync_jobs
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_kind is null or p_kind not in ('daily','v2_backfill') then
    return;
  end if;
  return query
  with candidate as (
    select j.id
    from public.gsc_sync_jobs j
    join public.client_integrations i on i.client_id = j.client_id and i.organization_id = j.organization_id
    join public.clients c on c.id = j.client_id and c.organization_id = j.organization_id
    where i.service = 'gsc'
      and i.sync_status in ('active','error')
      and i.credentials->>'site_url' = j.property
      and j.kind = p_kind
      and (p_client_id is null or j.client_id = p_client_id)
      and j.available_at <= now()
      and (j.status = 'pending' or (j.status = 'running' and j.lease_until < now()))
    order by j.updated_at, j.id
    for update of j skip locked
    limit 1
  )
  update public.gsc_sync_jobs j
  set status = 'running',
      lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds',
      attempts = j.attempts + 1,
      updated_at = now()
  from candidate
  where j.id = candidate.id
  returning j.*;
end;
$$;

revoke all on function public.enqueue_gsc_sync(uuid, uuid) from public, anon, authenticated;
revoke all on function public.enqueue_gsc_v2_backfill(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_gsc_sync(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_gsc_sync(uuid, uuid) to service_role;
grant execute on function public.enqueue_gsc_v2_backfill(uuid, uuid) to service_role;
grant execute on function public.claim_gsc_sync(uuid, text) to service_role;

alter table public.metrics add column if not exists provenance jsonb;

-- Optional provenance. A null argument leaves an existing value in place, so
-- GA4/GBP/Ahrefs writes do not clear a GSC finality record.
drop function if exists public.write_metric(uuid, uuid, text, text, jsonb, text, uuid, uuid);
create or replace function public.write_metric(
  p_organization_id uuid,
  p_client_id uuid,
  p_source text,
  p_metric_month text,
  p_data jsonb,
  p_source_type text,
  p_sync_run_id uuid default null,
  p_entered_by uuid default null,
  p_provenance jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted boolean;
begin
  if p_source_type not in ('auto', 'manual') then raise exception 'write_metric: invalid source_type'; end if;
  if p_metric_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'write_metric: invalid month'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'write_metric: data must be an object'; end if;
  if p_provenance is not null and jsonb_typeof(p_provenance) <> 'object' then
    raise exception 'write_metric: provenance must be an object';
  end if;
  perform 1 from public.clients where id = p_client_id and organization_id = p_organization_id;
  if not found then raise exception 'write_metric: client does not belong to organization'; end if;

  insert into public.metrics as m
    (organization_id, client_id, source, metric_month, date, data, source_type, sync_run_id, entered_by, updated_at, provenance)
  values
    (p_organization_id, p_client_id, p_source, p_metric_month, (p_metric_month || '-01')::date,
     p_data, p_source_type, p_sync_run_id, p_entered_by, now(), p_provenance)
  on conflict (client_id, source, metric_month) do update
    set data = excluded.data,
        source_type = excluded.source_type,
        sync_run_id = excluded.sync_run_id,
        entered_by = excluded.entered_by,
        date = excluded.date,
        provenance = case when p_provenance is null then m.provenance else excluded.provenance end
    where m.organization_id = excluded.organization_id
      and (m.source_type is distinct from 'manual' or excluded.source_type = 'manual')
  returning (xmax = 0) into v_inserted;

  if not found then return 'skipped_manual'; end if;
  return case when v_inserted then 'inserted' else 'updated' end;
end;
$$;

revoke all on function public.write_metric(uuid, uuid, text, text, jsonb, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.write_metric(uuid, uuid, text, text, jsonb, text, uuid, uuid, jsonb) to service_role;

-- Staff coverage for the connection push. security_invoker so RLS on clients,
-- integrations, and history still applies. site_url is the only credential field.
create or replace view public.client_search_coverage
with (security_invoker = true) as
select
  c.organization_id,
  c.id as client_id,
  c.name as client_name,
  c.status as client_status,
  (gsc.sync_status in ('active','error')) as gsc_connected,
  gsc.sync_status as gsc_sync_status,
  gsc.last_synced_at as gsc_last_success_at,
  case when gsc.sync_status in ('active','error') then gsc.credentials->>'site_url' else null end as gsc_property,
  hist.history_days,
  hist.history_start,
  hist.history_end,
  (ga4.sync_status in ('active','error')) as ga4_connected,
  ga4.sync_status as ga4_sync_status,
  ga4.last_synced_at as ga4_last_success_at,
  (gbp.sync_status in ('active','error')) as gbp_connected,
  gbp.sync_status as gbp_sync_status,
  gbp.last_synced_at as gbp_last_success_at,
  (ahrefs.sync_status in ('active','error')) as ahrefs_connected,
  ahrefs.sync_status as ahrefs_sync_status,
  ahrefs.last_synced_at as ahrefs_last_success_at
from public.clients c
left join public.client_integrations gsc
  on gsc.client_id = c.id and gsc.organization_id = c.organization_id and gsc.service = 'gsc'
left join public.client_integrations ga4
  on ga4.client_id = c.id and ga4.organization_id = c.organization_id and ga4.service = 'ga4'
left join public.client_integrations gbp
  on gbp.client_id = c.id and gbp.organization_id = c.organization_id and gbp.service = 'gbp'
left join public.client_integrations ahrefs
  on ahrefs.client_id = c.id and ahrefs.organization_id = c.organization_id and ahrefs.service = 'ahrefs'
left join lateral (
  select
    count(*)::integer as history_days,
    min(d.data_date) as history_start,
    max(d.data_date) as history_end
  from public.gsc_history_days d
  where d.client_id = c.id
    and d.organization_id = c.organization_id
    and d.search_type = 'web'
    and (gsc.credentials->>'site_url' is null or d.property = gsc.credentials->>'site_url')
) hist on true
where c.status = 'active';

revoke all on public.client_search_coverage from public, anon;
grant select on public.client_search_coverage to authenticated, service_role;
