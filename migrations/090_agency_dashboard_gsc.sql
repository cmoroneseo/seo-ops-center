-- 090: Agency dashboard aggregates over stored Search Console history.
-- 089 stays reserved for the Basecamp projection (list, prefix, group).
--
-- No new index.
-- gsc_history_days_org_idx (organization_id, client_id, data_date) already
-- limits the scan to one organization's days. One org is tens of thousands of
-- days, not the full facts table.
-- The facts unique key (day_id, grain, row_key) seeks grain = 'property' or
-- grain = 'query_page' for those day ids. A second facts index would copy
-- that path onto a table that is already hundreds of megabytes (see 074).
--
-- The function returns totals, sparkline buckets, and the top three queries.
-- It does not store a rollup. Apply it before turning AGENCY_DASHBOARD on.

create or replace function public.agency_dashboard_as_of(p_organization_id uuid)
returns date
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select max(d.data_date)
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
    and d.search_type = 'web'
    and exists (
      select 1 from public.gsc_history_facts f
      where f.day_id = d.id and f.grain = 'property'
    );
$$;

create or replace function public.agency_dashboard_gsc(
  p_organization_id uuid,
  p_current_start date,
  p_current_end date,
  p_previous_start date,
  p_previous_end date,
  p_bucket text
) returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_span integer;
  v_result jsonb;
begin
  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'Invalid dashboard bucket';
  end if;
  if p_current_start is null or p_current_end is null or p_previous_start is null or p_previous_end is null
     or p_current_start > p_current_end or p_previous_start > p_previous_end
     or p_previous_end >= p_current_start then
    raise exception 'Invalid dashboard range';
  end if;
  v_span := p_current_end - p_previous_start;
  if v_span > 800 then
    raise exception 'Dashboard range is too long';
  end if;

  with connected as (
    select c.id as client_id, i.credentials->>'site_url' as property
    from public.clients c
    join public.client_integrations i
      on i.client_id = c.id
     and i.organization_id = c.organization_id
     and i.service = 'gsc'
     and i.sync_status in ('active', 'error')
     and length(coalesce(i.credentials->>'site_url', '')) > 0
    where c.organization_id = p_organization_id
      and c.status = 'active'
  ),
  days as (
    select d.id, d.client_id, d.data_date, d.imported_at, d.is_incomplete
    from public.gsc_history_days d
    join connected x on x.client_id = d.client_id and x.property = d.property
    where d.organization_id = p_organization_id
      and d.search_type = 'web'
      and d.data_date between p_previous_start and p_current_end
  ),
  property as (
    select
      d.client_id,
      d.data_date,
      d.imported_at,
      d.is_incomplete,
      sum(f.clicks)::float8 as clicks,
      sum(f.impressions)::float8 as impressions,
      sum(case when f.impressions > 0 then f.position * f.impressions else null end)::float8 as position_weight
    from days d
    join public.gsc_history_facts f on f.day_id = d.id and f.grain = 'property'
    group by d.client_id, d.data_date, d.imported_at, d.is_incomplete
  ),
  current_totals as (
    select
      client_id,
      sum(clicks)::float8 as clicks,
      sum(impressions)::float8 as impressions,
      sum(position_weight)::float8 as position_weight,
      count(distinct data_date)::int as days,
      bool_or(is_incomplete) as incomplete
    from property
    where data_date between p_current_start and p_current_end
    group by client_id
  ),
  previous_totals as (
    select
      client_id,
      sum(clicks)::float8 as clicks,
      sum(impressions)::float8 as impressions,
      sum(position_weight)::float8 as position_weight,
      count(distinct data_date)::int as days
    from property
    where data_date between p_previous_start and p_previous_end
    group by client_id
  ),
  series as (
    select
      client_id,
      case p_bucket
        when 'week' then date_trunc('week', data_date)::date
        when 'month' then date_trunc('month', data_date)::date
        else data_date
      end as bucket,
      sum(clicks)::float8 as clicks,
      sum(impressions)::float8 as impressions,
      sum(position_weight)::float8 as position_weight
    from property
    where data_date between p_current_start and p_current_end
    group by client_id, 2
  ),
  grouped_queries as (
    select d.client_id, f.query, sum(f.clicks)::float8 as clicks
    from days d
    join public.gsc_history_facts f on f.day_id = d.id and f.grain = 'query_page'
    where d.data_date between p_current_start and p_current_end
      and f.query <> ''
    group by d.client_id, f.query
    having sum(f.clicks) > 0
  ),
  ranked_queries as (
    select client_id, query, clicks,
           row_number() over (partition by client_id order by clicks desc, query) as n
    from grouped_queries
  ),
  freshness as (
    select
      max(data_date) as latest_data_date,
      max(imported_at) as latest_imported_at,
      bool_or(is_incomplete) as settling
    from property
    where data_date between p_current_start and p_current_end
  )
  select jsonb_build_object(
    'current', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', client_id,
        'clicks', clicks,
        'impressions', impressions,
        'positionWeight', position_weight,
        'days', days,
        'incomplete', incomplete
      ) order by client_id)
      from current_totals
    ), '[]'::jsonb),
    'previous', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', client_id,
        'clicks', clicks,
        'impressions', impressions,
        'positionWeight', position_weight,
        'days', days
      ) order by client_id)
      from previous_totals
    ), '[]'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', client_id,
        'bucket', bucket,
        'clicks', clicks,
        'impressions', impressions,
        'positionWeight', position_weight
      ) order by client_id, bucket)
      from series
    ), '[]'::jsonb),
    'queries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', client_id,
        'query', query,
        'clicks', clicks
      ) order by client_id, n)
      from ranked_queries
      where n <= 3
    ), '[]'::jsonb),
    'freshness', (
      select jsonb_build_object(
        'latestDataDate', latest_data_date,
        'latestImportedAt', latest_imported_at,
        'settling', coalesce(settling, false)
      )
      from freshness
    )
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.agency_dashboard_as_of(uuid) from public, anon, authenticated;
revoke all on function public.agency_dashboard_gsc(uuid, date, date, date, date, text) from public, anon, authenticated;
grant execute on function public.agency_dashboard_as_of(uuid) to service_role;
grant execute on function public.agency_dashboard_gsc(uuid, date, date, date, date, text) to service_role;
