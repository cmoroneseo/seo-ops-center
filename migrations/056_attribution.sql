-- migrations/056_attribution.sql
-- Attribution tracking: sites, events, conversions

-- 1. Add avg_deal_value to clients
alter table public.clients
  add column if not exists avg_deal_value numeric;

-- 2. Attribution sites (one per tracked client website)
create table public.attribution_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  domain text not null check (length(domain) > 0),
  script_config jsonb not null default '{"hdyhau_inject": false, "hdyhau_field_patterns": [], "track_tel_clicks": true}'::jsonb,
  is_active boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id)
);

create index attribution_sites_org_idx on public.attribution_sites(organization_id);

alter table public.attribution_sites enable row level security;

create policy "Org members can manage attribution_sites"
  on public.attribution_sites for all
  using      (organization_id in (select get_user_org_ids()))
  with check (organization_id in (select get_user_org_ids()));

-- 3. Attribution events (high volume, 90-day retention on pageviews)
create table public.attribution_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.attribution_sites(id) on delete cascade,
  event_type text not null check (event_type in ('pageview', 'form_submit', 'tel_click')),
  session_id text not null,
  visitor_id text not null,
  source_category text not null,
  referrer_domain text,
  landing_page text not null default '',
  page_url text not null,
  hdyhau_response text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  country_code text,
  device_type text,
  created_at timestamptz not null default now()
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
grant select, insert on table public.attribution_events to service_role;

-- 4. Attribution conversions (permanent records)
create table public.attribution_conversions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.attribution_sites(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  event_id uuid not null references public.attribution_events(id) on delete cascade,
  conversion_type text not null check (conversion_type in ('form', 'phone', 'chat')),
  source_category text not null,
  landing_page text not null default '',
  page_url text not null,
  likely_queries jsonb,
  hdyhau_response text,
  month date not null,
  created_at timestamptz not null default now()
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
