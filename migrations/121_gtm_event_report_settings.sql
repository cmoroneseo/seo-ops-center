-- 121: per-client settings for the GTM Event Report.
--
-- NOT APPLIED. Do not run this against the production Supabase project.
-- The owner reviews and applies it separately.
--
-- The exclusion list is the consent-banner filter. It is not hardcoded to
-- one client. Kentina Hospitality would save "Allow cookies" and "Decline".
-- fallback_event_names is used only when Tag Manager is not connected.
-- The live tag list comes from the Tag Manager integration (migration 120).
--
-- Kentina, for setup notes only (not inserted here):
-- GA4 property 542058119 is chosen on the Analytics integration.
-- GTM account 6361320998, container 255732081, public id GTM-W8Q8SC6V
-- are chosen on the Tag Manager integration.

create table if not exists public.client_gtm_report_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  excluded_link_texts text[] not null default '{}',
  fallback_event_names text[] not null default '{}',
  outbound_event_name text not null default 'property_outbound_click',
  booking_event_name text not null default 'booking_click',
  ticket_event_name text not null default 'buy_tickets_click',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id),
  check (cardinality(excluded_link_texts) <= 30),
  check (cardinality(fallback_event_names) <= 40),
  check (outbound_event_name ~ '^[A-Za-z][A-Za-z0-9_]{0,40}$'),
  check (booking_event_name ~ '^[A-Za-z][A-Za-z0-9_]{0,40}$'),
  check (ticket_event_name ~ '^[A-Za-z][A-Za-z0-9_]{0,40}$')
);

create index if not exists client_gtm_report_settings_org_idx
  on public.client_gtm_report_settings (organization_id, client_id);

alter table public.client_gtm_report_settings enable row level security;

drop policy if exists client_gtm_report_settings_org on public.client_gtm_report_settings;
create policy client_gtm_report_settings_org on public.client_gtm_report_settings
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

revoke all on public.client_gtm_report_settings from public, anon;
grant select, insert, update on public.client_gtm_report_settings to authenticated;
grant all on public.client_gtm_report_settings to service_role;

comment on table public.client_gtm_report_settings is
  'Consent-click exclusions and optional saved event names for the GTM Event Report. Not a Tag Manager connection.';
