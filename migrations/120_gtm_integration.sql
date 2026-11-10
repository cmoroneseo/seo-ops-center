-- 120: Google Tag Manager as its own client integration.
--
-- Widens client_integrations.service so a row can be service 'gtm'.
-- Tokens and the chosen account/container stay in credentials, the same way
-- GA4 stores property_id. This file does not seed a client.
--
-- Kentina Hospitality, for the picker once this is applied (not inserted here):
-- GA4 property 542058119, GTM account 6361320998,
-- container 255732081, public id GTM-W8Q8SC6V.
--
-- The OAuth grant for this service is tagmanager.readonly only.
-- It does not include edit or publish scopes.

alter table public.client_integrations drop constraint if exists client_integrations_service_check;
alter table public.client_integrations
  add constraint client_integrations_service_check
  check (service in ('ga4', 'gsc', 'gbp', 'ahrefs', 'bing', 'gtm'));
