-- migrations/056_attribution.sql
-- Attribution tracking: sites, events, conversions

-- 1. Add avg_deal_value to clients
alter table public.clients
  add column if not exists avg_deal_value numeric;

-- Composite ownership keys protect the service-role path as well as RLS.
alter table public.clients add constraint clients_id_organization_id_key unique (id, organization_id);

-- 2. Attribution sites (one per tracked client website)
create table public.attribution_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  domain text not null check (
    length(domain) <= 253 and domain = lower(domain) and domain !~ '^www\.' and
    domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' and
    domain !~ '^[0-9]+(\.[0-9]+){3}$'
  ),
  script_config jsonb not null default '{"hdyhau_inject": false, "hdyhau_field_patterns": [], "track_tel_clicks": true}'::jsonb,
  is_active boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (client_id, organization_id) references public.clients(id, organization_id) on delete cascade,
  unique(client_id),
  unique(id, organization_id),
  unique(id, organization_id, client_id)
);

create index attribution_sites_org_idx on public.attribution_sites(organization_id);

alter table public.attribution_sites enable row level security;

create policy "Org members can manage attribution_sites"
  on public.attribution_sites for all
  using      (organization_id in (select get_user_org_ids()))
  with check (organization_id in (select get_user_org_ids()));

-- Only accepted collection events can verify a site. Members may edit setup
-- fields, but cannot forge verification or move a site to another client/org.
revoke all on table public.attribution_sites from public, anon, authenticated, service_role;
grant select, delete on table public.attribution_sites to authenticated;
grant insert (organization_id, client_id, domain, script_config, is_active) on public.attribution_sites to authenticated;
grant update (domain, script_config, is_active, updated_at) on public.attribution_sites to authenticated;
grant select, insert, update, delete on table public.attribution_sites to service_role;

create function public.invalidate_attribution_verification()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if new.domain is distinct from old.domain then new.verified_at := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger attribution_site_domain_changed before update on public.attribution_sites
for each row execute function public.invalidate_attribution_verification();
revoke all on function public.invalidate_attribution_verification() from public, anon, authenticated;

-- 3. Attribution events (high volume, 90-day retention on pageviews)
create table public.attribution_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null,
  site_domain text not null,
  event_type text not null check (event_type in ('pageview', 'form_submit', 'tel_click')),
  session_id text not null,
  visitor_id text not null,
  source_category text not null check (source_category in ('organic_google', 'organic_bing', 'organic_other', 'ai_chatgpt', 'ai_perplexity', 'ai_google_aio', 'social', 'paid', 'direct', 'referral', 'same_site')),
  referrer_domain text,
  landing_page text not null default '',
  page_url text not null,
  hdyhau_response text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  country_code text,
  device_type text,
  created_at timestamptz not null default now(),
  foreign key (site_id, organization_id) references public.attribution_sites(id, organization_id) on delete cascade,
  unique(id, site_id, organization_id)
);

create index attribution_events_site_created_idx on public.attribution_events(site_id, created_at);
create index attribution_events_site_type_created_idx on public.attribution_events(site_id, event_type, created_at);
create index attribution_events_org_idx on public.attribution_events(organization_id);

alter table public.attribution_events enable row level security;

create policy "Org members can read attribution_events"
  on public.attribution_events for select
  using (organization_id in (select get_user_org_ids()));

-- Events come from the unauthenticated collection endpoint, written with the
-- service-role key (which bypasses RLS). Revoke default grants and grant
-- explicitly so no authenticated-user role can write cross-tenant rows.
revoke all on table public.attribution_events from public, anon, authenticated;
grant select on table public.attribution_events to authenticated;
grant select, insert, delete on table public.attribution_events to service_role;

-- 4. Attribution conversions (permanent records)
create table public.attribution_conversions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null,
  client_id uuid not null,
  event_id uuid not null unique,
  conversion_type text not null check (conversion_type in ('form', 'phone', 'chat')),
  source_category text not null check (source_category in ('organic_google', 'organic_bing', 'organic_other', 'ai_chatgpt', 'ai_perplexity', 'ai_google_aio', 'social', 'paid', 'direct', 'referral', 'same_site')),
  landing_page text not null default '',
  page_url text not null,
  likely_queries jsonb,
  hdyhau_response text,
  month date not null check (extract(day from month) = 1),
  created_at timestamptz not null default now(),
  foreign key (site_id, organization_id, client_id)
    references public.attribution_sites(id, organization_id, client_id) on delete cascade,
  foreign key (event_id, site_id, organization_id)
    references public.attribution_events(id, site_id, organization_id) on delete cascade
);

create index attribution_conversions_client_month_idx on public.attribution_conversions(client_id, month);
create index attribution_conversions_site_created_idx on public.attribution_conversions(site_id, created_at);
create index attribution_conversions_org_idx on public.attribution_conversions(organization_id);

alter table public.attribution_conversions enable row level security;

create policy "Org members can read attribution_conversions"
  on public.attribution_conversions for select
  using (organization_id in (select get_user_org_ids()));

-- Conversions are written server-side with the service-role key (bypasses
-- RLS). Revoke default grants and grant explicitly so no authenticated-user
-- role can write cross-tenant rows.
revoke all on table public.attribution_conversions from public, anon, authenticated;
grant select on table public.attribution_conversions to authenticated;
grant select, insert, update on table public.attribution_conversions to service_role;

-- Each insert statement is atomic: NEW is the exact event being materialized.
-- Any conversion failure rolls back the event batch and its verification too.
-- Locking the site serializes receipt with domain edits so old queued batches
-- cannot verify a newly configured domain.
-- NO KEY UPDATE remains compatible with the FK key-share locks acquired by
-- concurrent inserts, avoiding a lock-upgrade deadlock on the same site.
create function public.materialize_attribution_event()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_site public.attribution_sites%rowtype;
begin
  select * into v_site from public.attribution_sites
    where id = new.site_id and organization_id = new.organization_id for no key update;
  if not found or not v_site.is_active or v_site.domain <> new.site_domain then
    raise exception 'Attribution site changed; reload the tracking page';
  end if;

  if new.event_type in ('form_submit', 'tel_click') then
    insert into public.attribution_conversions (
      organization_id, site_id, client_id, event_id, conversion_type,
      source_category, landing_page, page_url, hdyhau_response, month, created_at
    ) values (
      new.organization_id, new.site_id, v_site.client_id, new.id,
      case when new.event_type = 'form_submit' then 'form' else 'phone' end,
      new.source_category, new.landing_page, new.page_url, new.hdyhau_response,
      date_trunc('month', new.created_at at time zone 'UTC')::date, new.created_at
    );
  end if;

  if v_site.verified_at is null then
    update public.attribution_sites set verified_at = now()
      where id = v_site.id and organization_id = v_site.organization_id;
  end if;
  return new;
end;
$$;
create trigger attribution_event_received after insert on public.attribution_events
for each row execute function public.materialize_attribution_event();
revoke all on function public.materialize_attribution_event() from public, anon, authenticated;
grant execute on function public.materialize_attribution_event() to service_role;
