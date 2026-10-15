-- 098: Agency dashboard aggregate over ga4_daily.
-- Not applied in this change. Apply 096 first.
--
-- New function only. This file does not alter ga4_* tables, metrics, or
-- Search Console. Nothing calls it until NEXT_PUBLIC_GA4_CARDS is exactly
-- true.
--
-- No new index. ga4_history_days_org_idx (organization_id, client_id, day)
-- already limits the scan to one organization's days. One org is one row
-- per client per day, not the Search Console facts table.
--
-- sum() of a column that is entirely null is null. A measured zero is
-- included. This function does not coalesce a missing metric to 0.

create or replace function public.agency_dashboard_ga4(
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
    select c.id as client_id, i.credentials->>'property_id' as property
    from public.clients c
    join public.client_integrations i
      on i.client_id = c.id
     and i.organization_id = c.organization_id
     and i.service = 'ga4'
     and i.sync_status in ('active', 'error')
     and i.credentials->>'property_id' ~ '^properties/[0-9]+$'
    where c.organization_id = p_organization_id
      and c.status = 'active'
  ),
  days as (
    select
      d.client_id,
      d.day,
      m.organic_sessions,
      m.sessions,
      m.engaged_sessions,
      m.key_events
    from public.ga4_history_days d
    join connected x on x.client_id = d.client_id and x.property = d.property
    join public.ga4_daily m on m.day_id = d.id
    where d.organization_id = p_organization_id
      and d.day between p_previous_start and p_current_end
  ),
  current_totals as (
    select
      client_id,
      sum(organic_sessions)::float8 as organic_sessions,
      sum(sessions)::float8 as sessions,
      sum(engaged_sessions)::float8 as engaged_sessions,
      sum(key_events)::float8 as key_events,
      count(*)::int as days
    from days
    where day between p_current_start and p_current_end
    group by client_id
  ),
  previous_totals as (
    select
      client_id,
      sum(organic_sessions)::float8 as organic_sessions,
      sum(sessions)::float8 as sessions,
      sum(engaged_sessions)::float8 as engaged_sessions,
      sum(key_events)::float8 as key_events,
      count(*)::int as days
    from days
    where day between p_previous_start and p_previous_end
    group by client_id
  ),
  series as (
    select
      client_id,
      case p_bucket
        when 'week' then date_trunc('week', day)::date
        when 'month' then date_trunc('month', day)::date
        else day
      end as bucket,
      sum(organic_sessions)::float8 as organic_sessions,
      sum(key_events)::float8 as key_events
    from days
    where day between p_current_start and p_current_end
    group by client_id, 2
  )
  select jsonb_build_object(
    'current', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', client_id,
        'organicSessions', organic_sessions,
        'sessions', sessions,
        'engagedSessions', engaged_sessions,
        'keyEvents', key_events,
        'days', days
      ) order by client_id)
      from current_totals
    ), '[]'::jsonb),
    'previous', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', client_id,
        'organicSessions', organic_sessions,
        'sessions', sessions,
        'engagedSessions', engaged_sessions,
        'keyEvents', key_events,
        'days', days
      ) order by client_id)
      from previous_totals
    ), '[]'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', client_id,
        'bucket', bucket,
        'organicSessions', organic_sessions,
        'keyEvents', key_events
      ) order by client_id, bucket)
      from series
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.agency_dashboard_ga4(uuid, date, date, date, date, text) from public, anon, authenticated;
grant execute on function public.agency_dashboard_ga4(uuid, date, date, date, date, text) to service_role;
