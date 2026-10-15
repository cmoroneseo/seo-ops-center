-- 096: GA4 daily history. Not applied in this change.
--
-- New tables only. This file does not alter metrics, client_integrations,
-- gsc_history_*, or bing_*. Apply it before 097. Nothing calls these
-- functions until GA4_HISTORY_ENABLED is exactly true and the organization
-- is listed in GA4_ORG_IDS. Both stay off by default.
--
-- Metric columns have no default. A missing GA4 value is null. Zero is stored
-- only when the API returns a measured zero. Writes are service_role only.
-- Authenticated members can read rows in their own organizations.

create table public.ga4_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  property text not null check (property ~ '^properties/[0-9]+$'),
  kind text not null check (kind in ('daily', 'backfill')),
  status text not null default 'pending' check (status in ('pending', 'running', 'idle')),
  cursor_date date,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  updated_at timestamptz not null default now(),
  unique (client_id, property, kind)
);
create index ga4_sync_jobs_ready_idx on public.ga4_sync_jobs (available_at, updated_at);

create table public.ga4_history_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  property text not null check (property ~ '^properties/[0-9]+$'),
  day date not null,
  fetched_at timestamptz not null,
  is_final boolean not null,
  sampled boolean not null,
  thresholded boolean not null,
  row_count integer not null check (row_count >= 0),
  imported_at timestamptz not null default now(),
  unique (client_id, property, day)
);
create index ga4_history_days_org_idx
  on public.ga4_history_days (organization_id, client_id, day);

create table public.ga4_daily (
  day_id uuid primary key references public.ga4_history_days(id) on delete cascade,
  organic_sessions double precision,
  sessions double precision,
  engaged_sessions double precision,
  engagement_rate double precision,
  key_events double precision,
  total_key_events_by_name jsonb,
  -- Float isfinite() is not in every engine this file is tested on. NaN
  -- compares equal to NaN, so the three inequalities reject NaN and both
  -- infinities the same way isfinite() would on production Postgres.
  check (organic_sessions is null or (organic_sessions <> 'NaN'::double precision and organic_sessions <> 'Infinity'::double precision and organic_sessions <> '-Infinity'::double precision and organic_sessions >= 0)),
  check (sessions is null or (sessions <> 'NaN'::double precision and sessions <> 'Infinity'::double precision and sessions <> '-Infinity'::double precision and sessions >= 0)),
  check (engaged_sessions is null or (engaged_sessions <> 'NaN'::double precision and engaged_sessions <> 'Infinity'::double precision and engaged_sessions <> '-Infinity'::double precision and engaged_sessions >= 0)),
  check (engagement_rate is null or (engagement_rate <> 'NaN'::double precision and engagement_rate <> 'Infinity'::double precision and engagement_rate <> '-Infinity'::double precision and engagement_rate >= 0 and engagement_rate <= 1)),
  check (key_events is null or (key_events <> 'NaN'::double precision and key_events <> 'Infinity'::double precision and key_events <> '-Infinity'::double precision and key_events >= 0)),
  check (total_key_events_by_name is null or jsonb_typeof(total_key_events_by_name) = 'object')
);

create table public.ga4_landing_page_days (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.ga4_history_days(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  day date not null,
  landing_page_raw text not null check (length(landing_page_raw) > 0 and length(landing_page_raw) <= 2000),
  landing_page_norm text not null check (length(landing_page_norm) > 0 and length(landing_page_norm) <= 2000),
  organic_sessions double precision,
  engaged_sessions double precision,
  key_events double precision,
  check (organic_sessions is null or (organic_sessions <> 'NaN'::double precision and organic_sessions <> 'Infinity'::double precision and organic_sessions <> '-Infinity'::double precision and organic_sessions >= 0)),
  check (engaged_sessions is null or (engaged_sessions <> 'NaN'::double precision and engaged_sessions <> 'Infinity'::double precision and engaged_sessions <> '-Infinity'::double precision and engaged_sessions >= 0)),
  check (key_events is null or (key_events <> 'NaN'::double precision and key_events <> 'Infinity'::double precision and key_events <> '-Infinity'::double precision and key_events >= 0)),
  unique (day_id, landing_page_norm)
);
create index ga4_landing_page_days_lookup_idx
  on public.ga4_landing_page_days (client_id, landing_page_norm, day);

-- Null ga4_key_events means "every key event on the property". An array is
-- the client's override. Empty means they chose none, which stays null in
-- the daily totals rather than a synthetic zero.
create table public.client_ga4_settings (
  client_id uuid primary key references public.clients(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ga4_key_events text[],
  updated_at timestamptz not null default now(),
  check (ga4_key_events is null or cardinality(ga4_key_events) <= 50)
);

alter table public.ga4_sync_jobs enable row level security;
alter table public.ga4_history_days enable row level security;
alter table public.ga4_daily enable row level security;
alter table public.ga4_landing_page_days enable row level security;
alter table public.client_ga4_settings enable row level security;

create policy ga4_history_days_read on public.ga4_history_days
  for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));
create policy ga4_daily_read on public.ga4_daily
  for select to authenticated
  using (
    exists (
      select 1 from public.ga4_history_days day
      where day.id = ga4_daily.day_id
        and day.organization_id in (select public.get_user_org_ids())
    )
  );
create policy ga4_landing_page_days_read on public.ga4_landing_page_days
  for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));
create policy client_ga4_settings_read on public.client_ga4_settings
  for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

revoke all on public.ga4_sync_jobs, public.ga4_history_days, public.ga4_daily,
  public.ga4_landing_page_days, public.client_ga4_settings
  from anon, authenticated;
grant select on public.ga4_history_days, public.ga4_daily, public.ga4_landing_page_days, public.client_ga4_settings
  to authenticated;
grant all on public.ga4_sync_jobs, public.ga4_history_days, public.ga4_daily,
  public.ga4_landing_page_days, public.client_ga4_settings
  to service_role;

-- One property, one kind. A live lease is never stolen. A finished backfill
-- (cursor on the oldest of the 16 months) is not woken. Daily jobs wake once
-- available_at has passed. Missing analytics.readonly on a stored grant is
-- not queued; a row that predates granted_scopes still is.
create function public.enqueue_ga4_sync(p_organization_id uuid, p_client_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_property text;
begin
  select i.credentials ->> 'property_id' into v_property
  from public.client_integrations i
  join public.clients c on c.id = i.client_id and c.organization_id = i.organization_id
  where i.organization_id = p_organization_id
    and i.client_id = p_client_id
    and i.service = 'ga4'
    and i.sync_status in ('active', 'error')
    and i.credentials ->> 'property_id' ~ '^properties/[0-9]+$'
    and (
      not (i.credentials ? 'granted_scopes')
      or (
        jsonb_typeof(i.credentials -> 'granted_scopes') = 'array'
        and i.credentials -> 'granted_scopes' ? 'https://www.googleapis.com/auth/analytics.readonly'
      )
    );
  if v_property is null then
    return false;
  end if;
  insert into public.ga4_sync_jobs (organization_id, client_id, property, kind)
  values (p_organization_id, p_client_id, v_property, 'daily')
  on conflict (client_id, property, kind) do update
    set status = 'pending', available_at = now(), updated_at = now()
    where ga4_sync_jobs.status = 'idle' and ga4_sync_jobs.available_at <= now();
  return true;
end;
$function$;

create function public.enqueue_ga4_backfill(p_organization_id uuid, p_client_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_property text;
  v_oldest date;
begin
  select i.credentials ->> 'property_id' into v_property
  from public.client_integrations i
  join public.clients c on c.id = i.client_id and c.organization_id = i.organization_id
  where i.organization_id = p_organization_id
    and i.client_id = p_client_id
    and i.service = 'ga4'
    and i.sync_status in ('active', 'error')
    and i.credentials ->> 'property_id' ~ '^properties/[0-9]+$'
    and (
      not (i.credentials ? 'granted_scopes')
      or (
        jsonb_typeof(i.credentials -> 'granted_scopes') = 'array'
        and i.credentials -> 'granted_scopes' ? 'https://www.googleapis.com/auth/analytics.readonly'
      )
    );
  if v_property is null then
    return false;
  end if;
  -- 16 calendar months including the current UTC month.
  v_oldest := (date_trunc('month', (now() at time zone 'utc'))::date - interval '15 months')::date;
  insert into public.ga4_sync_jobs (organization_id, client_id, property, kind)
  values (p_organization_id, p_client_id, v_property, 'backfill')
  on conflict (client_id, property, kind) do update
    set status = 'pending', available_at = now(), updated_at = now()
    where ga4_sync_jobs.status = 'idle'
      and ga4_sync_jobs.available_at <= now()
      and (
        ga4_sync_jobs.cursor_date is null
        or ga4_sync_jobs.cursor_date > v_oldest
      );
  return true;
end;
$function$;

-- One job. At most one running lease per property, and at most five running
-- leases overall. skip locked so two workers cannot take the same row.
create function public.claim_ga4_sync(p_client_id uuid default null, p_kind text default 'daily')
returns setof public.ga4_sync_jobs
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
begin
  if p_kind is null or p_kind not in ('daily', 'backfill') then
    return;
  end if;
  if (
    select count(*)
    from public.ga4_sync_jobs running
    where running.status = 'running' and running.lease_until >= now()
  ) >= 5 then
    return;
  end if;
  return query
  with candidate as (
    select j.id
    from public.ga4_sync_jobs j
    join public.client_integrations i
      on i.client_id = j.client_id and i.organization_id = j.organization_id
    join public.clients c
      on c.id = j.client_id and c.organization_id = j.organization_id
    where i.service = 'ga4'
      and i.sync_status in ('active', 'error')
      and i.credentials ->> 'property_id' = j.property
      and j.kind = p_kind
      and (p_client_id is null or j.client_id = p_client_id)
      and j.available_at <= now()
      and (j.status = 'pending' or (j.status = 'running' and j.lease_until < now()))
      and not exists (
        select 1
        from public.ga4_sync_jobs other
        where other.client_id = j.client_id
          and other.property = j.property
          and other.id <> j.id
          and other.status = 'running'
          and other.lease_until >= now()
      )
    order by j.updated_at, j.id
    for update of j skip locked
    limit 1
  )
  update public.ga4_sync_jobs j
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

-- Atomic replace of one day. An older fetched_at does not overwrite.
-- JSON null and a missing key both store null. They are never coerced to 0.
create function public.replace_ga4_day(
  p_organization_id uuid,
  p_client_id uuid,
  p_property text,
  p_day date,
  p_fetched_at timestamptz,
  p_is_final boolean,
  p_sampled boolean,
  p_thresholded boolean,
  p_daily jsonb,
  p_landing_pages jsonb
) returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_id uuid;
  v_previous timestamptz;
begin
  if p_property is null or p_property !~ '^properties/[0-9]+$' then
    raise exception 'Invalid GA4 property';
  end if;
  if p_day is null or p_day > (now() at time zone 'utc')::date then
    raise exception 'GA4 day is missing or in the future';
  end if;
  if p_fetched_at is null or p_is_final is null or p_sampled is null or p_thresholded is null then
    raise exception 'GA4 day flags are required';
  end if;
  if p_daily is null or jsonb_typeof(p_daily) <> 'object' then
    raise exception 'Invalid GA4 daily payload';
  end if;
  if p_landing_pages is null or jsonb_typeof(p_landing_pages) <> 'array' or jsonb_array_length(p_landing_pages) > 10000 then
    raise exception 'Invalid GA4 landing page batch';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_daily) as key
    where key not in (
      'organic_sessions', 'sessions', 'engaged_sessions', 'engagement_rate',
      'key_events', 'total_key_events_by_name'
    )
  ) then
    raise exception 'Invalid GA4 daily payload';
  end if;

  perform 1 from public.clients
  where id = p_client_id and organization_id = p_organization_id;
  if not found then
    raise exception 'Client organization mismatch';
  end if;
  perform 1 from public.client_integrations
  where client_id = p_client_id
    and organization_id = p_organization_id
    and service = 'ga4'
    and sync_status in ('active', 'error')
    and credentials ->> 'property_id' = p_property
  for update;
  if not found then
    raise exception 'GA4 property changed; restart import';
  end if;

  if exists (
    select 1
    from (values
      ('organic_sessions'), ('sessions'), ('engaged_sessions'), ('key_events')
    ) as metric(name)
    where p_daily ? metric.name
      and p_daily -> metric.name <> 'null'::jsonb
      and (
        jsonb_typeof(p_daily -> metric.name) <> 'number'
        or (p_daily ->> metric.name)::double precision in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
        or (p_daily ->> metric.name)::double precision < 0
      )
  ) then
    raise exception 'Invalid GA4 metric';
  end if;
  if p_daily ? 'engagement_rate'
     and p_daily -> 'engagement_rate' <> 'null'::jsonb
     and (
       jsonb_typeof(p_daily -> 'engagement_rate') <> 'number'
       or (p_daily ->> 'engagement_rate')::double precision in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
       or (p_daily ->> 'engagement_rate')::double precision < 0
       or (p_daily ->> 'engagement_rate')::double precision > 1
     ) then
    raise exception 'Invalid GA4 engagement rate';
  end if;
  if p_daily ? 'total_key_events_by_name'
     and p_daily -> 'total_key_events_by_name' <> 'null'::jsonb
     and (
       jsonb_typeof(p_daily -> 'total_key_events_by_name') <> 'object'
       or (select count(*) from jsonb_object_keys(p_daily -> 'total_key_events_by_name')) > 50
       or exists (
         select 1
         from jsonb_each(p_daily -> 'total_key_events_by_name') as entry(key, value)
         where length(entry.key) = 0
           or length(entry.key) > 200
           or (
             entry.value <> 'null'::jsonb
             and (
               jsonb_typeof(entry.value) <> 'number'
               or (entry.value #>> '{}')::double precision in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
               or (entry.value #>> '{}')::double precision < 0
             )
           )
       )
     ) then
    raise exception 'Invalid GA4 key event breakdown';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_landing_pages) as page(
      landing_page_raw text,
      landing_page_norm text,
      organic_sessions double precision,
      engaged_sessions double precision,
      key_events double precision
    )
    where page.landing_page_raw is null
      or page.landing_page_norm is null
      or length(btrim(page.landing_page_raw)) = 0
      or length(page.landing_page_raw) > 2000
      or length(btrim(page.landing_page_norm)) = 0
      or length(page.landing_page_norm) > 2000
      or (page.organic_sessions is not null and (page.organic_sessions in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision) or page.organic_sessions < 0))
      or (page.engaged_sessions is not null and (page.engaged_sessions in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision) or page.engaged_sessions < 0))
      or (page.key_events is not null and (page.key_events in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision) or page.key_events < 0))
  ) then
    raise exception 'Invalid GA4 landing page';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_landing_pages) as page(landing_page_norm text)
    group by page.landing_page_norm
    having count(*) > 1
  ) then
    raise exception 'Duplicate GA4 landing page';
  end if;

  select id, fetched_at into v_id, v_previous
  from public.ga4_history_days
  where client_id = p_client_id and property = p_property and day = p_day
  for update;
  if found and v_previous > p_fetched_at then
    return false;
  end if;

  if v_id is null then
    insert into public.ga4_history_days (
      organization_id, client_id, property, day, fetched_at, is_final, sampled, thresholded, row_count
    ) values (
      p_organization_id, p_client_id, p_property, p_day, p_fetched_at,
      p_is_final, p_sampled, p_thresholded, jsonb_array_length(p_landing_pages)
    ) returning id into v_id;
  else
    update public.ga4_history_days
    set fetched_at = p_fetched_at,
        imported_at = now(),
        is_final = p_is_final,
        sampled = p_sampled,
        thresholded = p_thresholded,
        row_count = jsonb_array_length(p_landing_pages)
    where id = v_id;
    delete from public.ga4_landing_page_days where day_id = v_id;
  end if;

  insert into public.ga4_daily (
    day_id, organic_sessions, sessions, engaged_sessions, engagement_rate, key_events, total_key_events_by_name
  ) values (
    v_id,
    (p_daily ->> 'organic_sessions')::double precision,
    (p_daily ->> 'sessions')::double precision,
    (p_daily ->> 'engaged_sessions')::double precision,
    (p_daily ->> 'engagement_rate')::double precision,
    (p_daily ->> 'key_events')::double precision,
    case
      when p_daily -> 'total_key_events_by_name' is null or p_daily -> 'total_key_events_by_name' = 'null'::jsonb then null
      else p_daily -> 'total_key_events_by_name'
    end
  )
  on conflict (day_id) do update
    set organic_sessions = excluded.organic_sessions,
        sessions = excluded.sessions,
        engaged_sessions = excluded.engaged_sessions,
        engagement_rate = excluded.engagement_rate,
        key_events = excluded.key_events,
        total_key_events_by_name = excluded.total_key_events_by_name;

  insert into public.ga4_landing_page_days (
    day_id, organization_id, client_id, day, landing_page_raw, landing_page_norm,
    organic_sessions, engaged_sessions, key_events
  )
  select
    v_id, p_organization_id, p_client_id, p_day,
    page.landing_page_raw, page.landing_page_norm,
    page.organic_sessions, page.engaged_sessions, page.key_events
  from jsonb_to_recordset(p_landing_pages) as page(
    landing_page_raw text,
    landing_page_norm text,
    organic_sessions double precision,
    engaged_sessions double precision,
    key_events double precision
  );

  return true;
end;
$function$;

revoke all on function public.enqueue_ga4_sync(uuid, uuid) from public, anon, authenticated;
revoke all on function public.enqueue_ga4_backfill(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_ga4_sync(uuid, text) from public, anon, authenticated;
revoke all on function public.replace_ga4_day(uuid, uuid, text, date, timestamptz, boolean, boolean, boolean, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_ga4_sync(uuid, uuid) to service_role;
grant execute on function public.enqueue_ga4_backfill(uuid, uuid) to service_role;
grant execute on function public.claim_ga4_sync(uuid, text) to service_role;
grant execute on function public.replace_ga4_day(uuid, uuid, text, date, timestamptz, boolean, boolean, boolean, jsonb, jsonb) to service_role;
