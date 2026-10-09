-- 081: opt-in weekly digest.
-- 075 is reserved and unused. 080 is report sends.
--
-- Adds client_portal_settings.weekly_digest (default false).
-- Adds the weekly_digest email-queue kind without dropping existing kinds.
-- The default claim (p_kind null) skips report_send and weekly_digest.
-- The digest cron claims with p_kind = 'weekly_digest'.
--
-- This file does not insert queue rows and does not email anyone.
-- The cron writes a row only when WEEKLY_DIGEST_ENABLED is true and the
-- client has opted in.
--
-- Apply this file in the Supabase SQL editor before the app that calls it
-- is deployed.
--
-- Rollback:
-- delete from public.client_portal_email_queue where event_kind = 'weekly_digest';
-- alter table public.client_portal_email_queue drop constraint if exists client_portal_email_queue_event_kind_check;
-- alter table public.client_portal_email_queue add constraint client_portal_email_queue_event_kind_check
--   check (event_kind in ('plan', 'report', 'reply', 'update', 'request', 'report_send'));
-- create or replace function public.claim_client_portal_emails(p_limit integer default 20, p_kind text default null)
-- returns setof public.client_portal_email_queue
-- language plpgsql
-- security invoker
-- set search_path = public, pg_catalog
-- as $$
-- begin
--   update public.client_portal_email_queue set failed_at = now(), claimed_at = null
--   where sent_at is null and canceled_at is null and failed_at is null and attempts >= 6
--     and (claimed_at is null or claimed_at < now() - interval '15 minutes');
--   return query update public.client_portal_email_queue set claimed_at = now(), attempts = attempts + 1
--   where id in (
--     select id from public.client_portal_email_queue
--     where sent_at is null and canceled_at is null and failed_at is null and attempts < 6 and available_at <= now()
--       and (claimed_at is null or claimed_at < now() - interval '15 minutes')
--       and (
--         (p_kind is null and event_kind <> 'report_send')
--         or (p_kind is not null and event_kind = p_kind)
--       )
--     order by available_at
--     for update skip locked
--     limit greatest(0, least(p_limit, 50))
--   ) returning *;
-- end $$;
-- revoke all on function public.claim_client_portal_emails(integer, text) from public, anon, authenticated;
-- grant execute on function public.claim_client_portal_emails(integer, text) to service_role;
-- alter table public.client_portal_settings drop column if exists weekly_digest;

alter table public.client_portal_settings
  add column if not exists weekly_digest boolean not null default false;

comment on column public.client_portal_settings.weekly_digest is
  'Staff opt-in for the Monday work digest. Default off. Sending also requires the server flag.';

alter table public.client_portal_email_queue
  drop constraint if exists client_portal_email_queue_event_kind_check;

alter table public.client_portal_email_queue
  add constraint client_portal_email_queue_event_kind_check
  check (event_kind in ('plan', 'report', 'reply', 'update', 'request', 'report_send', 'weekly_digest'));

create or replace function public.claim_client_portal_emails(p_limit integer default 20, p_kind text default null)
returns setof public.client_portal_email_queue
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  update public.client_portal_email_queue set failed_at = now(), claimed_at = null
  where sent_at is null and canceled_at is null and failed_at is null and attempts >= 6
    and (claimed_at is null or claimed_at < now() - interval '15 minutes');
  return query update public.client_portal_email_queue set claimed_at = now(), attempts = attempts + 1
  where id in (
    select id from public.client_portal_email_queue
    where sent_at is null and canceled_at is null and failed_at is null and attempts < 6 and available_at <= now()
      and (claimed_at is null or claimed_at < now() - interval '15 minutes')
      and (
        (p_kind is null and event_kind not in ('report_send', 'weekly_digest'))
        or (p_kind is not null and event_kind = p_kind)
      )
    order by available_at
    for update skip locked
    limit greatest(0, least(p_limit, 50))
  ) returning *;
end $$;

revoke all on function public.claim_client_portal_emails(integer, text) from public, anon, authenticated;
grant execute on function public.claim_client_portal_emails(integer, text) to service_role;
