-- 094: Bing Webmaster snapshots. Not applied in this change.
--
-- Bing is a second source. It is never written into gsc_history_days or
-- gsc_history_facts, and this migration does not alter those tables or build
-- an index on them. gsc_history_facts is about 2.4M rows and 890MB.
-- Migration 093's gsc_history_facts_query_clicks_idx scans that heap and
-- blocks writes until the build finishes. Apply 094 only after that build
-- has finished. 094 itself creates empty tables, plus a short lock while it
-- widens the service check on the small client_integrations table.
--
-- Nothing in the application calls these functions yet. BING_WEBMASTER stays
-- off unless it is the exact string true and the org is on
-- BING_WEBMASTER_ORG_IDS. GetUserSites also returns AuthenticationCode and
-- DnsVerificationCode. Discard both. The only credential stored for service
-- bing is the exact site URL.

alter table public.client_integrations drop constraint if exists client_integrations_service_check;
alter table public.client_integrations
  add constraint client_integrations_service_check
  check (service in ('ga4', 'gsc', 'gbp', 'ahrefs', 'bing'));

alter table public.client_integrations drop constraint if exists client_integrations_bing_site_url_check;
alter table public.client_integrations
  add constraint client_integrations_bing_site_url_check
  check (
    service <> 'bing'
    or (
      jsonb_typeof(credentials) = 'object'
      and credentials ? 'site_url'
      and (credentials - 'site_url') = '{}'::jsonb
      and length(credentials ->> 'site_url') > 0
      and length(credentials ->> 'site_url') <= 2000
    )
  );

-- Daily traffic. Clicks and impressions only. Bing does not return a position
-- on this call, so there is no position column to average with Google.
create table public.bing_traffic_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  site_url text not null check (length(site_url) > 0),
  data_date date not null,
  clicks bigint not null check (clicks >= 0),
  impressions bigint not null check (impressions >= 0),
  queries_complete boolean not null,
  pages_complete boolean not null,
  fetched_at timestamptz not null,
  imported_at timestamptz not null default now(),
  unique (client_id, site_url, data_date)
);
create index bing_traffic_days_org_idx
  on public.bing_traffic_days (organization_id, client_id, data_date);

-- Weekly query totals. A week stays one row. Positions are null when Bing
-- omits them. AvgClickPosition is stored and is not a dashboard number.
create table public.bing_query_weeks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  site_url text not null check (length(site_url) > 0),
  week_ending date not null,
  query text not null check (length(query) > 0),
  clicks bigint not null check (clicks >= 0),
  impressions bigint not null check (impressions >= 0),
  avg_impression_position double precision,
  avg_click_position double precision,
  stale boolean not null default false,
  query_key text generated always as (md5(query)) stored,
  fetched_at timestamptz not null,
  imported_at timestamptz not null default now(),
  check (
    avg_impression_position is null
    or (avg_impression_position >= 0 and avg_impression_position < 'Infinity'::float8)
  ),
  check (
    avg_click_position is null
    or (avg_click_position >= 0 and avg_click_position < 'Infinity'::float8)
  ),
  unique (client_id, site_url, week_ending, query_key)
);
create index bing_query_weeks_org_idx
  on public.bing_query_weeks (organization_id, client_id, week_ending);

-- Weekly page totals. Bing returns pages on the same QueryStats shape.
-- The page URL arrives in the Query field and is stored here as page.
create table public.bing_page_weeks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  site_url text not null check (length(site_url) > 0),
  week_ending date not null,
  page text not null check (length(page) > 0),
  clicks bigint not null check (clicks >= 0),
  impressions bigint not null check (impressions >= 0),
  avg_impression_position double precision,
  avg_click_position double precision,
  stale boolean not null default false,
  page_key text generated always as (md5(page)) stored,
  fetched_at timestamptz not null,
  imported_at timestamptz not null default now(),
  check (
    avg_impression_position is null
    or (avg_impression_position >= 0 and avg_impression_position < 'Infinity'::float8)
  ),
  check (
    avg_click_position is null
    or (avg_click_position >= 0 and avg_click_position < 'Infinity'::float8)
  ),
  unique (client_id, site_url, week_ending, page_key)
);
create index bing_page_weeks_org_idx
  on public.bing_page_weeks (organization_id, client_id, week_ending);

-- One site snapshot, not one day. Same lease shape as the original GSC job:
-- pending / running / idle, skip locked, service-role only.
create table public.bing_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  site_url text not null check (length(site_url) > 0),
  status text not null default 'pending' check (status in ('pending', 'running', 'idle')),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now(),
  unique (client_id, site_url)
);
create index bing_sync_jobs_ready_idx on public.bing_sync_jobs (available_at, updated_at);

alter table public.bing_traffic_days enable row level security;
alter table public.bing_query_weeks enable row level security;
alter table public.bing_page_weeks enable row level security;
alter table public.bing_sync_jobs enable row level security;

create policy bing_traffic_days_read on public.bing_traffic_days
  for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));
create policy bing_query_weeks_read on public.bing_query_weeks
  for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));
create policy bing_page_weeks_read on public.bing_page_weeks
  for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

revoke all on public.bing_traffic_days, public.bing_query_weeks, public.bing_page_weeks, public.bing_sync_jobs
  from anon, authenticated;
grant select on public.bing_traffic_days, public.bing_query_weeks, public.bing_page_weeks to authenticated;
grant all on public.bing_traffic_days, public.bing_query_weeks, public.bing_page_weeks, public.bing_sync_jobs to service_role;

-- One transaction. A null query or page batch keeps the previous weeks and
-- marks them stale. A failed statement rolls back, so a bad payload cannot
-- leave a half-written week. An older fetched_at does not overwrite.
create function public.replace_bing_snapshot(
  p_organization_id uuid,
  p_client_id uuid,
  p_site_url text,
  p_fetched_at timestamptz,
  p_traffic jsonb,
  p_queries jsonb,
  p_pages jsonb
) returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_existing timestamptz;
begin
  if p_site_url is null or length(p_site_url) = 0 or length(p_site_url) > 2000 then
    raise exception 'Invalid Bing site URL';
  end if;
  if p_fetched_at is null then
    raise exception 'Bing snapshot requires fetched_at';
  end if;
  if p_traffic is null or jsonb_typeof(p_traffic) <> 'array' or jsonb_array_length(p_traffic) > 800 then
    raise exception 'Invalid Bing traffic batch';
  end if;
  if p_queries is not null and (jsonb_typeof(p_queries) <> 'array' or jsonb_array_length(p_queries) > 100000) then
    raise exception 'Invalid Bing query batch';
  end if;
  if p_pages is not null and (jsonb_typeof(p_pages) <> 'array' or jsonb_array_length(p_pages) > 100000) then
    raise exception 'Invalid Bing page batch';
  end if;

  perform 1 from public.clients
  where id = p_client_id and organization_id = p_organization_id;
  if not found then
    raise exception 'Client organization mismatch';
  end if;

  perform 1 from public.client_integrations
  where client_id = p_client_id
    and organization_id = p_organization_id
    and service = 'bing'
    and sync_status in ('active', 'error')
    and credentials ->> 'site_url' = p_site_url
  for update;
  if not found then
    raise exception 'Bing site changed; restart import';
  end if;

  perform 1
  from public.bing_traffic_days
  where client_id = p_client_id and site_url = p_site_url
  for update;
  select max(fetched_at) into v_existing
  from public.bing_traffic_days
  where client_id = p_client_id and site_url = p_site_url;
  if v_existing is not null and v_existing > p_fetched_at then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_traffic) as x(data_date date, clicks bigint, impressions bigint)
    where x.data_date is null or x.clicks is null or x.impressions is null
      or x.clicks < 0 or x.impressions < 0
  ) then
    raise exception 'Invalid Bing traffic row';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_traffic) as x(data_date date, clicks bigint, impressions bigint)
    group by x.data_date
    having count(*) > 1
  ) then
    raise exception 'Duplicate Bing traffic day';
  end if;

  if p_queries is not null then
    if exists (
      select 1
      from jsonb_to_recordset(p_queries) as x(
        week_ending date,
        query text,
        clicks bigint,
        impressions bigint,
        avg_impression_position double precision,
        avg_click_position double precision
      )
      where x.week_ending is null
        or x.query is null
        or length(btrim(x.query)) = 0
        or length(x.query) > 2000
        or x.clicks is null
        or x.impressions is null
        or x.clicks < 0
        or x.impressions < 0
        or (
          x.avg_impression_position is not null
          and (x.avg_impression_position < 0 or x.avg_impression_position >= 'Infinity'::float8)
        )
        or (
          x.avg_click_position is not null
          and (x.avg_click_position < 0 or x.avg_click_position >= 'Infinity'::float8)
        )
    ) then
      raise exception 'Invalid Bing query row';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_queries) as x(week_ending date, query text)
      group by x.week_ending, md5(x.query)
      having count(*) > 1
    ) then
      raise exception 'Duplicate Bing query week';
    end if;
  end if;

  if p_pages is not null then
    if exists (
      select 1
      from jsonb_to_recordset(p_pages) as x(
        week_ending date,
        page text,
        clicks bigint,
        impressions bigint,
        avg_impression_position double precision,
        avg_click_position double precision
      )
      where x.week_ending is null
        or x.page is null
        or length(btrim(x.page)) = 0
        or length(x.page) > 2000
        or x.clicks is null
        or x.impressions is null
        or x.clicks < 0
        or x.impressions < 0
        or (
          x.avg_impression_position is not null
          and (x.avg_impression_position < 0 or x.avg_impression_position >= 'Infinity'::float8)
        )
        or (
          x.avg_click_position is not null
          and (x.avg_click_position < 0 or x.avg_click_position >= 'Infinity'::float8)
        )
    ) then
      raise exception 'Invalid Bing page row';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_pages) as x(week_ending date, page text)
      group by x.week_ending, md5(x.page)
      having count(*) > 1
    ) then
      raise exception 'Duplicate Bing page week';
    end if;
  end if;

  delete from public.bing_traffic_days
  where client_id = p_client_id and site_url = p_site_url;

  insert into public.bing_traffic_days (
    organization_id, client_id, site_url, data_date, clicks, impressions,
    queries_complete, pages_complete, fetched_at
  )
  select
    p_organization_id,
    p_client_id,
    p_site_url,
    x.data_date,
    x.clicks,
    x.impressions,
    p_queries is not null,
    p_pages is not null,
    p_fetched_at
  from jsonb_to_recordset(p_traffic) as x(data_date date, clicks bigint, impressions bigint);

  if p_queries is null then
    update public.bing_query_weeks
    set stale = true
    where client_id = p_client_id and site_url = p_site_url;
  else
    delete from public.bing_query_weeks
    where client_id = p_client_id and site_url = p_site_url;
    insert into public.bing_query_weeks (
      organization_id, client_id, site_url, week_ending, query, clicks, impressions,
      avg_impression_position, avg_click_position, stale, fetched_at
    )
    select
      p_organization_id,
      p_client_id,
      p_site_url,
      x.week_ending,
      x.query,
      x.clicks,
      x.impressions,
      x.avg_impression_position,
      x.avg_click_position,
      false,
      p_fetched_at
    from jsonb_to_recordset(p_queries) as x(
      week_ending date,
      query text,
      clicks bigint,
      impressions bigint,
      avg_impression_position double precision,
      avg_click_position double precision
    );
  end if;

  if p_pages is null then
    update public.bing_page_weeks
    set stale = true
    where client_id = p_client_id and site_url = p_site_url;
  else
    delete from public.bing_page_weeks
    where client_id = p_client_id and site_url = p_site_url;
    insert into public.bing_page_weeks (
      organization_id, client_id, site_url, week_ending, page, clicks, impressions,
      avg_impression_position, avg_click_position, stale, fetched_at
    )
    select
      p_organization_id,
      p_client_id,
      p_site_url,
      x.week_ending,
      x.page,
      x.clicks,
      x.impressions,
      x.avg_impression_position,
      x.avg_click_position,
      false,
      p_fetched_at
    from jsonb_to_recordset(p_pages) as x(
      week_ending date,
      page text,
      clicks bigint,
      impressions bigint,
      avg_impression_position double precision,
      avg_click_position double precision
    );
  end if;

  return true;
end;
$function$;

-- Enqueue is idempotent, honors retry cooldowns, and never steals a live lease.
create function public.enqueue_bing_sync(p_organization_id uuid, p_client_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_site_url text;
begin
  select i.credentials ->> 'site_url' into v_site_url
  from public.client_integrations i
  join public.clients c on c.id = i.client_id and c.organization_id = i.organization_id
  where i.organization_id = p_organization_id
    and i.client_id = p_client_id
    and i.service = 'bing'
    and i.sync_status in ('active', 'error')
    and length(i.credentials ->> 'site_url') > 0;
  if v_site_url is null then
    return false;
  end if;
  insert into public.bing_sync_jobs (organization_id, client_id, site_url)
  values (p_organization_id, p_client_id, v_site_url)
  on conflict (client_id, site_url) do update
    set status = 'pending', available_at = now(), updated_at = now()
    where bing_sync_jobs.status = 'idle' and bing_sync_jobs.available_at <= now();
  return true;
end;
$function$;

create function public.claim_bing_sync(p_client_id uuid default null)
returns setof public.bing_sync_jobs
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
begin
  return query
  with candidate as (
    select j.id
    from public.bing_sync_jobs j
    join public.client_integrations i
      on i.client_id = j.client_id and i.organization_id = j.organization_id
    join public.clients c
      on c.id = j.client_id and c.organization_id = j.organization_id
    where i.service = 'bing'
      and i.sync_status in ('active', 'error')
      and i.credentials ->> 'site_url' = j.site_url
      and (p_client_id is null or j.client_id = p_client_id)
      and j.available_at <= now()
      and (j.status = 'pending' or (j.status = 'running' and j.lease_until < now()))
    order by j.updated_at, j.id
    for update of j skip locked
    limit 1
  )
  update public.bing_sync_jobs j
  set status = 'running',
      lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds',
      attempts = j.attempts + 1,
      updated_at = now()
  from candidate
  where j.id = candidate.id
  returning j.*;
end;
$function$;

-- Traffic totals and sparklines from daily rows. Position comes only from
-- weekly AvgImpressionPosition, weighted by that week's impressions. A week
-- counts when week_ending falls inside the range. Weeks are not split into
-- days. Top queries are Bing's own list. There is no rank field.
create function public.agency_dashboard_bing(
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
    select c.id as client_id, i.credentials ->> 'site_url' as site_url
    from public.clients c
    join public.client_integrations i
      on i.client_id = c.id
     and i.organization_id = c.organization_id
     and i.service = 'bing'
     and i.sync_status in ('active', 'error')
     and length(coalesce(i.credentials ->> 'site_url', '')) > 0
    where c.organization_id = p_organization_id
      and c.status = 'active'
  ),
  traffic as (
    select d.client_id, d.data_date, d.clicks::float8 as clicks, d.impressions::float8 as impressions,
           d.queries_complete, d.pages_complete
    from public.bing_traffic_days d
    join connected x on x.client_id = d.client_id and x.site_url = d.site_url
    where d.organization_id = p_organization_id
      and d.data_date between p_previous_start and p_current_end
  ),
  current_traffic as (
    select client_id,
           sum(clicks)::float8 as clicks,
           sum(impressions)::float8 as impressions,
           count(distinct data_date)::int as days,
           bool_and(queries_complete) as queries_complete,
           bool_and(pages_complete) as pages_complete
    from traffic
    where data_date between p_current_start and p_current_end
    group by client_id
  ),
  previous_traffic as (
    select client_id,
           sum(clicks)::float8 as clicks,
           sum(impressions)::float8 as impressions,
           count(distinct data_date)::int as days
    from traffic
    where data_date between p_previous_start and p_previous_end
    group by client_id
  ),
  series as (
    select client_id,
           case p_bucket
             when 'week' then date_trunc('week', data_date)::date
             when 'month' then date_trunc('month', data_date)::date
             else data_date
           end as bucket,
           sum(clicks)::float8 as clicks,
           sum(impressions)::float8 as impressions
    from traffic
    where data_date between p_current_start and p_current_end
    group by client_id, 2
  ),
  query_rows as (
    select q.client_id, q.week_ending, q.query, q.clicks::float8 as clicks, q.impressions::float8 as impressions,
           q.avg_impression_position, q.stale
    from public.bing_query_weeks q
    join connected x on x.client_id = q.client_id and x.site_url = q.site_url
    where q.organization_id = p_organization_id
      and q.week_ending between p_previous_start and p_current_end
  ),
  current_position as (
    select client_id,
           (sum(avg_impression_position * impressions) filter (where avg_impression_position is not null))::float8 as position_weight,
           (sum(impressions) filter (where avg_impression_position is not null))::float8 as position_impressions
    from query_rows
    where week_ending between p_current_start and p_current_end
    group by client_id
  ),
  previous_position as (
    select client_id,
           (sum(avg_impression_position * impressions) filter (where avg_impression_position is not null))::float8 as position_weight,
           (sum(impressions) filter (where avg_impression_position is not null))::float8 as position_impressions
    from query_rows
    where week_ending between p_previous_start and p_previous_end
    group by client_id
  ),
  current_ids as (
    select client_id from current_traffic
    union
    select client_id from current_position
  ),
  previous_ids as (
    select client_id from previous_traffic
    union
    select client_id from previous_position
  ),
  position_series as (
    select client_id,
           week_ending,
           (sum(avg_impression_position * impressions) filter (where avg_impression_position is not null))::float8 as position_weight,
           (sum(impressions) filter (where avg_impression_position is not null))::float8 as position_impressions
    from query_rows
    where week_ending between p_current_start and p_current_end
    group by client_id, week_ending
  ),
  snapshot_state as (
    select x.client_id,
           bool_and(d.queries_complete) as queries_complete,
           bool_or(q.stale) as query_stale
    from connected x
    left join public.bing_traffic_days d
      on d.client_id = x.client_id and d.site_url = x.site_url and d.organization_id = p_organization_id
    left join public.bing_query_weeks q
      on q.client_id = x.client_id and q.site_url = x.site_url and q.organization_id = p_organization_id
    group by x.client_id
  ),
  ranked_queries as (
    select client_id, query, clicks, impressions, avg_impression_position,
           row_number() over (partition by client_id order by clicks desc, query) as n
    from (
      select client_id,
             query,
             sum(clicks)::float8 as clicks,
             sum(impressions)::float8 as impressions,
             case
               when sum(impressions) filter (where avg_impression_position is not null) > 0
               then (
                 sum(avg_impression_position * impressions) filter (where avg_impression_position is not null)
                 / sum(impressions) filter (where avg_impression_position is not null)
               )::float8
               else null
             end as avg_impression_position
      from query_rows
      where week_ending between p_current_start and p_current_end
      group by client_id, query
    ) grouped
    where clicks > 0
  )
  select jsonb_build_object(
    'current', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', ids.client_id,
        'clicks', t.clicks,
        'impressions', t.impressions,
        'days', t.days,
        'positionWeight', p.position_weight,
        'positionImpressions', coalesce(p.position_impressions, 0),
        'queriesComplete', t.queries_complete,
        'pagesComplete', t.pages_complete
      ) order by ids.client_id)
      from current_ids ids
      left join current_traffic t on t.client_id = ids.client_id
      left join current_position p on p.client_id = ids.client_id
    ), '[]'::jsonb),
    'previous', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', ids.client_id,
        'clicks', t.clicks,
        'impressions', t.impressions,
        'days', t.days,
        'positionWeight', p.position_weight,
        'positionImpressions', coalesce(p.position_impressions, 0)
      ) order by ids.client_id)
      from previous_ids ids
      left join previous_traffic t on t.client_id = ids.client_id
      left join previous_position p on p.client_id = ids.client_id
    ), '[]'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', client_id,
        'bucket', bucket,
        'clicks', clicks,
        'impressions', impressions
      ) order by client_id, bucket)
      from series
    ), '[]'::jsonb),
    'positionSeries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', client_id,
        'weekEnding', week_ending,
        'positionWeight', position_weight,
        'positionImpressions', coalesce(position_impressions, 0)
      ) order by client_id, week_ending)
      from position_series
    ), '[]'::jsonb),
    'queries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', s.client_id,
        'stale', coalesce(s.queries_complete = false, false) or coalesce(s.query_stale, false),
        'queries', coalesce((
          select jsonb_agg(jsonb_build_object(
            'query', r.query,
            'clicks', r.clicks,
            'impressions', r.impressions,
            'avgImpressionPosition', r.avg_impression_position
          ) order by r.n)
          from ranked_queries r
          where r.client_id = s.client_id and r.n <= 3
        ), '[]'::jsonb)
      ) order by s.client_id)
      from snapshot_state s
      where s.queries_complete is not null or s.query_stale is not null
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.replace_bing_snapshot(uuid, uuid, text, timestamptz, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_bing_sync(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_bing_sync(uuid) from public, anon, authenticated;
revoke all on function public.agency_dashboard_bing(uuid, date, date, date, date, text) from public, anon, authenticated;
grant execute on function public.replace_bing_snapshot(uuid, uuid, text, timestamptz, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.enqueue_bing_sync(uuid, uuid) to service_role;
grant execute on function public.claim_bing_sync(uuid) to service_role;
grant execute on function public.agency_dashboard_bing(uuid, date, date, date, date, text) to service_role;
