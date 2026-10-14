-- 093: Make top queries finish inside the API statement timeout.
-- 089 stays reserved for the Basecamp projection (list, prefix, group).
-- Supersedes the query scan inside 091. Do not edit 091 in place.
-- Not applied in this change.
--
-- Root cause, measured 2026-10-14 on project sgszojorcftyaknruckh for
-- Marketing Empire Group. Scott Cole Plumbing, 12 Volt Power, and
-- Vitatherapy Wellness Medspa are not a property mismatch and they are not
-- missing the query grain:
--   site_url equals gsc_history_days.property for each client
--   query_page rows exist (12 Volt Power has 615 of them on 2026-10-01)
-- agency_dashboard_top_queries for 12 Volt Power across the 12M window
-- (2025-10-14 through 2026-10-13) took 15.5s and read ~188k buffers.
-- PostgREST logs in as authenticator (statement_timeout = 8s) and then
-- set role service_role, so the 8s limit still applies. The cancel is what
-- the card shows as "Could not load queries." A 28-day window returns.
--
-- Almost every query_page row has zero clicks (that same day sums to 9
-- clicks across 615 rows). The unique index is (day_id, grain, row_key),
-- so the aggregate heap-fetches the page URL on every zero-click row.
-- This partial index keeps only rows that can rank, and covers query and
-- clicks so the top-3 aggregate is an index-only scan. The zero-click
-- existence check still uses the unique index and stops at the first row,
-- which is what distinguishes "query detail was not stored" from
-- "no queries with clicks."
--
-- Building the index scans gsc_history_facts (about 2.4M rows, 890MB) and
-- takes a lock that blocks writes until the build finishes.

create index if not exists gsc_history_facts_query_clicks_idx
  on public.gsc_history_facts (day_id, query)
  include (clicks)
  where grain = 'query_page' and clicks > 0 and query <> '';

create or replace function public.agency_dashboard_top_queries(
  p_organization_id uuid,
  p_client_id uuid,
  p_start date,
  p_end date
) returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_result jsonb;
begin
  if p_start is null or p_end is null or p_start > p_end or (p_end - p_start) > 400 then
    raise exception 'Invalid dashboard range';
  end if;

  with days as (
    select d.id
    from public.gsc_history_days d
    join public.clients c
      on c.id = d.client_id
     and c.organization_id = d.organization_id
     and c.status = 'active'
    join public.client_integrations i
      on i.client_id = d.client_id
     and i.organization_id = d.organization_id
     and i.service = 'gsc'
     and i.sync_status in ('active', 'error')
     and i.credentials->>'site_url' = d.property
    where d.organization_id = p_organization_id
      and d.client_id = p_client_id
      and d.search_type = 'web'
      and d.data_date between p_start and p_end
  ),
  clicked as (
    select f.query, sum(f.clicks)::float8 as clicks
    from days d
    join public.gsc_history_facts f
      on f.day_id = d.id
     and f.grain = 'query_page'
     and f.clicks > 0
     and f.query <> ''
    group by f.query
  ),
  top as (
    select coalesce((
      select jsonb_agg(jsonb_build_object('query', query, 'clicks', clicks) order by n)
      from (
        select query, clicks, row_number() over (order by clicks desc, query) as n
        from clicked
      ) ranked
      where n <= 3
    ), '[]'::jsonb) as queries
  )
  select jsonb_build_object(
    'queries', top.queries,
    'reason', case
      when top.queries <> '[]'::jsonb then null
      when exists (
        select 1
        from days d
        join public.gsc_history_facts f
          on f.day_id = d.id
         and f.grain = 'query_page'
      ) then 'no_clicks'
      else 'not_stored'
    end
  ) into v_result
  from top;

  return v_result;
end;
$function$;

revoke all on function public.agency_dashboard_top_queries(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.agency_dashboard_top_queries(uuid, uuid, date, date) to service_role;
