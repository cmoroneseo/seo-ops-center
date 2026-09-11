-- Stable page identities, immutable crawl observations, and a resumable
-- service-only crawl queue. Crawl-health rollups remain compute-on-read.

create table public.site_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id, client_id)
);

create table public.site_page_urls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  site_page_id uuid not null,
  raw_url text not null check (length(raw_url) between 1 and 8192),
  normalized_url text not null check (length(normalized_url) between 1 and 8192),
  normalization_version smallint not null default 1 check (normalization_version = 1),
  discovery_sources text[] not null default '{}' check (discovery_sources <@ array['seed','sitemap','gsc','internal','redirect']::text[]),
  is_primary boolean not null default false,
  first_observed_at timestamptz not null default timezone('utc', now()),
  last_observed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (site_page_id, organization_id, client_id)
    references public.site_pages(id, organization_id, client_id) on delete cascade,
  unique (client_id, normalized_url),
  unique (id, site_page_id, organization_id, client_id)
);
create unique index site_page_urls_one_primary_idx on public.site_page_urls(site_page_id) where is_primary;
create index site_page_urls_client_seen_idx on public.site_page_urls(organization_id, client_id, last_observed_at desc);

create table public.site_crawl_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  seed_url text not null check (length(seed_url) between 1 and 8192),
  configured_host text not null check (length(configured_host) between 1 and 253),
  url_limit integer not null default 200 check (url_limit between 10 and 500),
  status text not null default 'queued' check (status in ('queued','running','paused','completed','failed','cancelled')),
  discovered_count integer not null default 0 check (discovered_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  blocked_count integer not null default 0 check (blocked_count >= 0),
  cap_reached boolean not null default false,
  stop_reason text check (stop_reason is null or length(stop_reason) <= 500),
  error_summary text check (error_summary is null or length(error_summary) <= 1000),
  robots_url text check (robots_url is null or length(robots_url) <= 8192),
  robots_fetched_at timestamptz,
  robots_status integer,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, organization_id, client_id)
);
create unique index site_crawl_runs_one_active_idx on public.site_crawl_runs(client_id)
  where status in ('queued','running','paused');
create index site_crawl_runs_client_created_idx on public.site_crawl_runs(organization_id, client_id, created_at desc);

create table public.site_crawl_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid not null,
  raw_url text not null check (length(raw_url) between 1 and 8192),
  normalized_url text not null check (length(normalized_url) between 1 and 8192),
  discovery_sources text[] not null default '{}' check (discovery_sources <@ array['seed','sitemap','gsc','internal','redirect']::text[]),
  depth smallint not null default 0 check (depth between 0 and 50),
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','skipped')),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
  terminal_classification text check (terminal_classification is null or length(terminal_classification) <= 100),
  site_page_id uuid,
  site_page_url_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (run_id, organization_id, client_id)
    references public.site_crawl_runs(id, organization_id, client_id) on delete cascade,
  foreign key (site_page_id, organization_id, client_id)
    references public.site_pages(id, organization_id, client_id) on delete restrict,
  unique (run_id, normalized_url),
  unique (id, run_id, organization_id, client_id)
);
create index site_crawl_targets_queue_idx on public.site_crawl_targets(run_id, status, depth, created_at);
create index site_crawl_targets_lease_idx on public.site_crawl_targets(run_id, lease_expires_at) where status = 'processing';

create table public.site_page_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid not null,
  target_id uuid not null,
  site_page_id uuid not null,
  site_page_url_id uuid not null,
  observed_at timestamptz not null default timezone('utc', now()),
  requested_url text not null check (length(requested_url) between 1 and 8192),
  final_url text check (final_url is null or length(final_url) between 1 and 8192),
  fetch_status text not null check (fetch_status in ('success','failed','blocked','unsupported','oversized','js_unresolved')),
  status_code integer check (status_code is null or status_code between 100 and 599),
  content_type text check (content_type is null or length(content_type) <= 255),
  response_bytes integer check (response_bytes is null or response_bytes >= 0),
  redirect_hops jsonb not null default '[]'::jsonb check (jsonb_typeof(redirect_hops) = 'array' and pg_column_size(redirect_hops) <= 65536),
  robots_allowed boolean,
  robots_directives text[] not null default '{}',
  canonical_url text check (canonical_url is null or length(canonical_url) <= 8192),
  canonical_issue text check (canonical_issue is null or canonical_issue in ('none','missing','malformed','off_scope','conflicting','cycle','target_failed','target_redirect')),
  title text check (title is null or length(title) <= 2000),
  meta_description text check (meta_description is null or length(meta_description) <= 4000),
  h1s text[] not null default '{}',
  word_count integer check (word_count is null or word_count >= 0),
  inbound_internal_links integer not null default 0 check (inbound_internal_links >= 0),
  outbound_internal_links integer not null default 0 check (outbound_internal_links >= 0),
  limitation_flags text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (run_id, organization_id, client_id)
    references public.site_crawl_runs(id, organization_id, client_id) on delete cascade,
  foreign key (target_id, run_id, organization_id, client_id)
    references public.site_crawl_targets(id, run_id, organization_id, client_id) on delete cascade,
  foreign key (site_page_id, organization_id, client_id)
    references public.site_pages(id, organization_id, client_id) on delete cascade,
  foreign key (site_page_url_id, site_page_id, organization_id, client_id)
    references public.site_page_urls(id, site_page_id, organization_id, client_id) on delete cascade,
  unique (run_id, target_id)
);
create index site_page_snapshots_run_idx on public.site_page_snapshots(run_id, observed_at desc);
create index site_page_snapshots_page_idx on public.site_page_snapshots(organization_id, client_id, site_page_id, observed_at desc);

create table public.site_link_observations (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid not null,
  source_snapshot_id uuid not null references public.site_page_snapshots(id) on delete cascade,
  source_page_id uuid not null,
  destination_raw_url text not null check (length(destination_raw_url) between 1 and 8192),
  destination_normalized_url text not null check (length(destination_normalized_url) between 1 and 8192),
  destination_page_id uuid,
  anchor_text text not null default '' check (length(anchor_text) <= 2000),
  nofollow boolean not null default false,
  occurrence_count integer not null default 1 check (occurrence_count between 1 and 100000),
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (run_id, organization_id, client_id)
    references public.site_crawl_runs(id, organization_id, client_id) on delete cascade,
  foreign key (source_page_id, organization_id, client_id)
    references public.site_pages(id, organization_id, client_id) on delete cascade,
  foreign key (destination_page_id, organization_id, client_id)
    references public.site_pages(id, organization_id, client_id) on delete restrict,
  unique (source_snapshot_id, destination_normalized_url, anchor_text, nofollow)
);
create index site_link_observations_destination_idx on public.site_link_observations(run_id, destination_normalized_url);

create or replace function public.guard_site_inventory_client_scope()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if not exists (select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id) then
    raise exception 'Site inventory client scope mismatch';
  end if;
  return new;
end;
$$;

create trigger site_pages_scope_guard before insert or update on public.site_pages for each row execute function public.guard_site_inventory_client_scope();
create trigger site_page_urls_scope_guard before insert or update on public.site_page_urls for each row execute function public.guard_site_inventory_client_scope();
create trigger site_crawl_runs_scope_guard before insert or update on public.site_crawl_runs for each row execute function public.guard_site_inventory_client_scope();
create trigger site_crawl_targets_scope_guard before insert or update on public.site_crawl_targets for each row execute function public.guard_site_inventory_client_scope();
create trigger site_page_snapshots_scope_guard before insert or update on public.site_page_snapshots for each row execute function public.guard_site_inventory_client_scope();
create trigger site_link_observations_scope_guard before insert or update on public.site_link_observations for each row execute function public.guard_site_inventory_client_scope();

create or replace function public.guard_site_page_snapshot_immutable()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Site page snapshots are immutable';
end;
$$;
create trigger site_page_snapshots_immutable before update or delete on public.site_page_snapshots
  for each row execute function public.guard_site_page_snapshot_immutable();

create or replace function public.claim_site_crawl_targets(p_run_id uuid, p_lease_token uuid, p_limit integer default 5)
returns setof public.site_crawl_targets
language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if p_limit < 1 or p_limit > 20 then raise exception 'Crawl claim limit must be between 1 and 20'; end if;
  if p_lease_token is null then raise exception 'Crawl lease token is required'; end if;

  update public.site_crawl_targets
  set status = case when attempt_count >= 3 then 'failed' else 'queued' end,
      terminal_classification = case when attempt_count >= 3 then 'attempt_limit' else terminal_classification end,
      lease_token = null, lease_expires_at = null, updated_at = timezone('utc', now())
  where run_id = p_run_id and status = 'processing' and lease_expires_at < timezone('utc', now());

  update public.site_crawl_runs
  set status = 'running', started_at = coalesce(started_at, timezone('utc', now())), updated_at = timezone('utc', now())
  where id = p_run_id and status in ('queued','running','paused');

  return query
  with candidates as (
    select id from public.site_crawl_targets
    where run_id = p_run_id and status = 'queued' and attempt_count < 3
    order by depth, created_at, id
    for update skip locked
    limit p_limit
  )
  update public.site_crawl_targets target
  set status = 'processing', lease_token = p_lease_token,
      lease_expires_at = timezone('utc', now()) + interval '2 minutes',
      attempt_count = target.attempt_count + 1, updated_at = timezone('utc', now())
  from candidates where target.id = candidates.id
  returning target.*;
end;
$$;

alter table public.site_pages enable row level security;
alter table public.site_page_urls enable row level security;
alter table public.site_crawl_runs enable row level security;
alter table public.site_crawl_targets enable row level security;
alter table public.site_page_snapshots enable row level security;
alter table public.site_link_observations enable row level security;

create policy site_pages_read on public.site_pages for select to authenticated using (organization_id in (select public.get_user_org_ids()));
create policy site_page_urls_read on public.site_page_urls for select to authenticated using (organization_id in (select public.get_user_org_ids()));
create policy site_crawl_runs_read on public.site_crawl_runs for select to authenticated using (organization_id in (select public.get_user_org_ids()));
create policy site_crawl_targets_read on public.site_crawl_targets for select to authenticated using (organization_id in (select public.get_user_org_ids()));
create policy site_page_snapshots_read on public.site_page_snapshots for select to authenticated using (organization_id in (select public.get_user_org_ids()));
create policy site_link_observations_read on public.site_link_observations for select to authenticated using (organization_id in (select public.get_user_org_ids()));

revoke all on public.site_pages, public.site_page_urls, public.site_crawl_runs, public.site_crawl_targets, public.site_page_snapshots, public.site_link_observations from anon, authenticated;
grant select on public.site_pages, public.site_page_urls, public.site_crawl_runs, public.site_page_snapshots, public.site_link_observations to authenticated;
grant all on public.site_pages, public.site_page_urls, public.site_crawl_runs, public.site_crawl_targets, public.site_page_snapshots, public.site_link_observations to service_role;
grant usage, select on sequence public.site_link_observations_id_seq to service_role;

revoke all on function public.guard_site_inventory_client_scope() from public, anon, authenticated;
revoke all on function public.guard_site_page_snapshot_immutable() from public, anon, authenticated;
revoke all on function public.claim_site_crawl_targets(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.guard_site_inventory_client_scope() to service_role;
grant execute on function public.guard_site_page_snapshot_immutable() to service_role;
grant execute on function public.claim_site_crawl_targets(uuid, uuid, integer) to service_role;
