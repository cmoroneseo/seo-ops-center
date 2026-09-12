-- Keep high-confidence non-page assets from consuming the bounded page crawl cap.

alter table public.site_crawl_runs
  add column asset_exclusion_cap_reached boolean not null default false;

create or replace function public.enqueue_site_crawl_target(
  p_run_id uuid, p_raw_url text, p_normalized_url text, p_sources text[], p_depth integer
)
returns boolean
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_run public.site_crawl_runs%rowtype; v_existing public.site_crawl_targets%rowtype;
begin
  select * into v_run from public.site_crawl_runs where id = p_run_id for update;
  if not found or v_run.status not in ('queued','running','paused') then raise exception 'Crawl run is not active'; end if;
  if p_depth < 0 or p_depth > 50 then raise exception 'Invalid crawl depth'; end if;
  select * into v_existing from public.site_crawl_targets where run_id = p_run_id and normalized_url = p_normalized_url for update;
  if found then
    update public.site_crawl_targets
    set discovery_sources = (select array_agg(distinct source order by source) from unnest(discovery_sources || p_sources) source),
        depth = least(depth, p_depth), updated_at = timezone('utc', now())
    where id = v_existing.id;
    return v_existing.status <> 'skipped';
  end if;
  if (select count(*) from public.site_crawl_targets where run_id = p_run_id and status <> 'skipped') >= v_run.url_limit then
    update public.site_crawl_runs set cap_reached = true, updated_at = timezone('utc', now()) where id = p_run_id;
    return false;
  end if;
  insert into public.site_crawl_targets(organization_id, client_id, run_id, raw_url, normalized_url, discovery_sources, depth)
  values (v_run.organization_id, v_run.client_id, p_run_id, p_raw_url, p_normalized_url, p_sources, p_depth);
  update public.site_crawl_runs set discovered_count = discovered_count + 1, updated_at = timezone('utc', now()) where id = p_run_id;
  return true;
end;
$$;

create or replace function public.record_site_crawl_asset_exclusion(
  p_run_id uuid, p_raw_url text, p_normalized_url text, p_sources text[], p_depth integer
)
returns boolean
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_run public.site_crawl_runs%rowtype; v_existing public.site_crawl_targets%rowtype;
begin
  select * into v_run from public.site_crawl_runs where id = p_run_id for update;
  if not found or v_run.status not in ('queued','running','paused') then raise exception 'Crawl run is not active'; end if;
  if p_depth < 0 or p_depth > 50 then raise exception 'Invalid crawl depth'; end if;
  select * into v_existing from public.site_crawl_targets where run_id = p_run_id and normalized_url = p_normalized_url for update;
  if found then
    update public.site_crawl_targets
    set discovery_sources = (select array_agg(distinct source order by source) from unnest(discovery_sources || p_sources) source),
        depth = least(depth, p_depth), updated_at = timezone('utc', now())
    where id = v_existing.id and status = 'skipped';
    return false;
  end if;
  if (select count(*) from public.site_crawl_targets where run_id = p_run_id and status = 'skipped') >= v_run.url_limit then
    update public.site_crawl_runs set asset_exclusion_cap_reached = true, updated_at = timezone('utc', now()) where id = p_run_id;
    return false;
  end if;
  insert into public.site_crawl_targets(
    organization_id, client_id, run_id, raw_url, normalized_url, discovery_sources, depth, status, terminal_classification
  ) values (
    v_run.organization_id, v_run.client_id, p_run_id, p_raw_url, p_normalized_url, p_sources, p_depth, 'skipped', 'known_non_page_asset'
  );
  return true;
end;
$$;

revoke all on function public.record_site_crawl_asset_exclusion(uuid, text, text, text[], integer) from public, anon, authenticated;
grant execute on function public.record_site_crawl_asset_exclusion(uuid, text, text, text[], integer) to service_role;
