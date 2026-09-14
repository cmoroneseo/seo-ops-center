-- 057 attribution hardening
-- Durable ingestion quotas and supporting constraints/indexes.

alter table public.clients
  add constraint clients_avg_deal_value_valid
  check (avg_deal_value is null or (avg_deal_value > 0 and avg_deal_value <= 1000000000));

create table public.attribution_rate_limits (
  site_id uuid not null references public.attribution_sites(id) on delete cascade,
  bucket_key text not null check (length(bucket_key) between 1 and 64),
  window_start timestamptz not null,
  event_count integer not null check (event_count >= 0),
  primary key (site_id, bucket_key, window_start)
);

create index attribution_rate_limits_site_window_idx
  on public.attribution_rate_limits(site_id, window_start);

create index attribution_events_pageview_cleanup_idx
  on public.attribution_events(created_at)
  where event_type = 'pageview';

alter table public.attribution_rate_limits enable row level security;
revoke all on table public.attribution_rate_limits from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.attribution_rate_limits to service_role;

create function public.check_attribution_rate_limit(
  p_site_id uuid,
  p_bucket_key text,
  p_event_count integer
) returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_window timestamptz := date_trunc('minute', clock_timestamp());
  v_site_count integer;
  v_ip_count integer;
begin
  if p_event_count < 1 or p_event_count > 50 or length(p_bucket_key) not between 1 and 64 then
    return false;
  end if;

  insert into public.attribution_rate_limits(site_id, bucket_key, window_start, event_count)
  values (p_site_id, '__site__', v_window, p_event_count)
  on conflict (site_id, bucket_key, window_start) do update
    set event_count = public.attribution_rate_limits.event_count + excluded.event_count
  returning event_count into v_site_count;

  if v_site_count > 1000 then
    return false;
  end if;

  insert into public.attribution_rate_limits(site_id, bucket_key, window_start, event_count)
  values (p_site_id, p_bucket_key, v_window, p_event_count)
  on conflict (site_id, bucket_key, window_start) do update
    set event_count = public.attribution_rate_limits.event_count + excluded.event_count
  returning event_count into v_ip_count;

  return v_ip_count <= 100;
end;
$$;

revoke all on function public.check_attribution_rate_limit(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.check_attribution_rate_limit(uuid, text, integer)
  to service_role;
