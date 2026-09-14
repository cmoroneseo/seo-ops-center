-- 058 attribution canary integrity
-- Enforce the rollout boundary, make retries idempotent, and prevent rejected
-- traffic from consuming accepted-event quotas.

create table public.attribution_enabled_organizations (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.attribution_enabled_organizations(organization_id)
select id from public.organizations
where id = '06e536b9-beac-49bc-8c96-1df021102590'
on conflict do nothing;

alter table public.attribution_enabled_organizations enable row level security;
revoke all on table public.attribution_enabled_organizations from public, anon, authenticated, service_role;
grant select, insert, delete on table public.attribution_enabled_organizations to service_role;

create function public.is_attribution_enabled(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.attribution_enabled_organizations
    where organization_id = p_organization_id
  )
$$;
revoke all on function public.is_attribution_enabled(uuid) from public, anon;
grant execute on function public.is_attribution_enabled(uuid) to authenticated, service_role;

drop policy "Org members can manage attribution_sites" on public.attribution_sites;
create policy "Enabled org members can manage attribution_sites"
  on public.attribution_sites for all
  using (
    organization_id in (select get_user_org_ids())
    and public.is_attribution_enabled(organization_id)
  )
  with check (
    organization_id in (select get_user_org_ids())
    and public.is_attribution_enabled(organization_id)
  );

alter table public.attribution_events add column client_event_id text;
update public.attribution_events set client_event_id = id::text where client_event_id is null;
alter table public.attribution_events alter column client_event_id set not null;
alter table public.attribution_events
  add constraint attribution_events_client_event_id_valid
  check (length(client_event_id) between 1 and 128);
alter table public.attribution_events
  add constraint attribution_events_site_client_event_id_key unique (site_id, client_event_id);

create or replace function public.check_attribution_rate_limit(
  p_site_id uuid,
  p_bucket_key text,
  p_event_count integer
) returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_minute timestamptz := date_trunc('minute', clock_timestamp());
  v_hour timestamptz := date_trunc('hour', clock_timestamp());
  v_day timestamptz := date_trunc('day', clock_timestamp());
  v_ip_count integer;
  v_minute_count integer;
  v_hour_count integer;
  v_day_count integer;
begin
  if p_event_count < 1 or p_event_count > 50 or length(p_bucket_key) not between 1 and 64 then
    return false;
  end if;

  perform 1 from public.attribution_sites site
    join public.attribution_enabled_organizations enabled on enabled.organization_id = site.organization_id
    where site.id = p_site_id and site.is_active
    for update of site;
  if not found then return false; end if;

  select coalesce(max(event_count), 0) into v_ip_count
    from public.attribution_rate_limits where site_id = p_site_id and bucket_key = p_bucket_key and window_start = v_minute;
  select coalesce(max(event_count), 0) into v_minute_count
    from public.attribution_rate_limits where site_id = p_site_id and bucket_key = '__site_minute__' and window_start = v_minute;
  select coalesce(max(event_count), 0) into v_hour_count
    from public.attribution_rate_limits where site_id = p_site_id and bucket_key = '__site_hour__' and window_start = v_hour;
  select coalesce(max(event_count), 0) into v_day_count
    from public.attribution_rate_limits where site_id = p_site_id and bucket_key = '__site_day__' and window_start = v_day;

  if v_ip_count + p_event_count > 100
    or v_minute_count + p_event_count > 500
    or v_hour_count + p_event_count > 2000
    or v_day_count + p_event_count > 10000 then
    return false;
  end if;

  insert into public.attribution_rate_limits(site_id, bucket_key, window_start, event_count)
  values
    (p_site_id, p_bucket_key, v_minute, p_event_count),
    (p_site_id, '__site_minute__', v_minute, p_event_count),
    (p_site_id, '__site_hour__', v_hour, p_event_count),
    (p_site_id, '__site_day__', v_day, p_event_count)
  on conflict (site_id, bucket_key, window_start) do update
    set event_count = public.attribution_rate_limits.event_count + excluded.event_count;

  return true;
end;
$$;

revoke all on function public.check_attribution_rate_limit(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.check_attribution_rate_limit(uuid, text, integer)
  to service_role;
