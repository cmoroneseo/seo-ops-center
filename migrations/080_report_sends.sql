-- 080: one scheduled send per frozen report version.
-- 075 is reserved and unused. 078 and 079 are already taken.
--
-- This file does not insert sends and does not email anyone.
-- The cron writes a row only when REPORT_SEND_ENABLED is true.
--
-- Apply this file in the Supabase SQL editor before the app that calls it
-- is deployed.
--
-- Rollback:
-- drop trigger if exists report_sends_belong on public.report_sends;
-- drop function if exists public.report_sends_belong();
-- drop function if exists public.publish_frozen_report_share(uuid, uuid, uuid, jsonb);
-- drop table if exists public.report_sends;
-- drop function if exists public.claim_client_portal_emails(integer, text);
-- create function public.claim_client_portal_emails(p_limit integer default 20)
-- returns setof public.client_portal_email_queue
-- language plpgsql security invoker set search_path = public, pg_catalog as $$
-- begin
--   update public.client_portal_email_queue set failed_at = now(), claimed_at = null
--   where sent_at is null and canceled_at is null and failed_at is null and attempts >= 6
--     and (claimed_at is null or claimed_at < now() - interval '15 minutes');
--   return query update public.client_portal_email_queue set claimed_at = now(), attempts = attempts + 1
--   where id in (select id from public.client_portal_email_queue
--     where sent_at is null and canceled_at is null and failed_at is null and attempts < 6 and available_at <= now()
--       and (claimed_at is null or claimed_at < now() - interval '15 minutes')
--     order by available_at for update skip locked limit greatest(0, least(p_limit, 50))) returning *;
-- end $$;
-- revoke all on function public.claim_client_portal_emails(integer) from public, anon, authenticated;
-- grant execute on function public.claim_client_portal_emails(integer) to service_role;
-- alter table public.client_portal_email_queue drop constraint if exists client_portal_email_queue_event_kind_check;
-- alter table public.client_portal_email_queue add constraint client_portal_email_queue_event_kind_check
--   check (event_kind in ('plan', 'report', 'reply', 'update', 'request'));

create table public.report_sends (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  report_id uuid not null references public.reports(id) on delete restrict,
  version_id uuid not null references public.report_versions(id) on delete cascade,
  review_id uuid not null references public.report_reviews(id) on delete cascade,
  contact_id uuid references public.client_portal_contacts(id) on delete set null,
  scheduled_for timestamptz not null,
  status text not null check (status in ('queued', 'sent', 'skipped_no_contact', 'canceled')),
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint report_sends_version_once unique (version_id),
  constraint report_sends_shape check (
    (status = 'skipped_no_contact' and contact_id is null and sent_at is null)
    or (status = 'canceled' and sent_at is null)
    or (status = 'queued' and contact_id is not null and sent_at is null)
    or (status = 'sent' and contact_id is not null and sent_at is not null)
  )
);

create index report_sends_org_idx
  on public.report_sends (organization_id, client_id, scheduled_for desc);

create index report_sends_queued_idx
  on public.report_sends (scheduled_for)
  where status = 'queued';

alter table public.report_sends enable row level security;

create policy report_sends_select
  on public.report_sends
  for select
  to authenticated
  using (organization_id in (select public.get_user_org_ids()));

revoke all on table public.report_sends from public, anon, authenticated;
grant select on table public.report_sends to authenticated;
grant all on table public.report_sends to service_role;

create or replace function public.report_sends_belong()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.report_versions v
    where v.id = new.version_id
      and v.report_id = new.report_id
      and v.organization_id = new.organization_id
      and v.client_id = new.client_id
  ) then
    raise exception 'The send does not belong to this version.'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.report_reviews r
    where r.id = new.review_id
      and r.report_id = new.report_id
      and r.organization_id = new.organization_id
      and r.client_id = new.client_id
      and r.current_version_id = new.version_id
  ) then
    raise exception 'The send does not belong to this review.'
      using errcode = '23514';
  end if;

  return new;
end $$;

create trigger report_sends_belong
  before insert or update on public.report_sends
  for each row
  execute function public.report_sends_belong();

alter table public.client_portal_email_queue
  drop constraint if exists client_portal_email_queue_event_kind_check;

alter table public.client_portal_email_queue
  add constraint client_portal_email_queue_event_kind_check
  check (event_kind in ('plan', 'report', 'reply', 'update', 'request', 'report_send'));

create or replace function public.queue_client_portal_email()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare kind text; path text;
begin
  if tg_table_name = 'client_portal_report_shares'
     and current_setting('seo.skip_report_email', true) = '1' then
    return new;
  end if;
  if tg_table_name = 'client_portal_feedback' then
    if new.staff_user_id is null then return new; end if;
    if new.subject_type = 'plan' and not exists(select 1 from public.client_portal_plan_shares where marketing_plan_id = new.subject_id and client_id = new.client_id and organization_id = new.organization_id and unshared_at is null) then return new; end if;
    if new.subject_type = 'waiting_item' and not exists(select 1 from public.client_portal_waiting_items where id = new.subject_id and client_id = new.client_id and organization_id = new.organization_id and resolved_at is null) then return new; end if;
    kind := 'reply'; path := case new.subject_type when 'plan' then '/portal/plan' when 'waiting_item' then '/portal/pending' else '/portal/messages' end;
  elsif tg_table_name = 'client_portal_plan_shares' then
    kind := 'plan'; path := '/portal/plan';
  elsif tg_table_name = 'client_portal_report_shares' then
    kind := 'report'; path := '/portal/reports/' || new.report_id;
  elsif tg_table_name = 'client_portal_updates' then
    kind := 'update'; path := '/portal';
  else
    kind := 'request'; path := '/portal/pending';
  end if;
  insert into public.client_portal_email_queue (organization_id,client_id,contact_id,event_kind,event_id,next_path)
    select new.organization_id,new.client_id,c.id,kind,new.id,path from public.client_portal_contacts c
    where c.organization_id = new.organization_id and c.client_id = new.client_id and c.revoked_at is null
    on conflict (event_kind,event_id,contact_id) do nothing;
  return new;
end $$;

revoke all on function public.queue_client_portal_email() from public, anon, authenticated;
grant execute on function public.queue_client_portal_email() to service_role;

drop function if exists public.claim_client_portal_emails(integer);

create function public.claim_client_portal_emails(p_limit integer default 20, p_kind text default null)
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
        (p_kind is null and event_kind <> 'report_send')
        or (p_kind is not null and event_kind = p_kind)
      )
    order by available_at
    for update skip locked
    limit greatest(0, least(p_limit, 50))
  ) returning *;
end $$;

revoke all on function public.claim_client_portal_emails(integer, text) from public, anon, authenticated;
grant execute on function public.claim_client_portal_emails(integer, text) to service_role;

create function public.publish_frozen_report_share(p_org uuid, p_client uuid, p_report uuid, p_snapshot jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare existing uuid;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Snapshot required' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.reports
    where id = p_report and organization_id = p_org and client_id = p_client
  ) then
    raise exception 'Unknown report' using errcode = '23514';
  end if;
  update public.reports
    set status = 'published', updated_at = timezone('utc', now())
    where id = p_report and organization_id = p_org and client_id = p_client;
  select id into existing
    from public.client_portal_report_shares
    where report_id = p_report and organization_id = p_org and client_id = p_client and unshared_at is null
    limit 1;
  if existing is not null then
    update public.client_portal_report_shares set snapshot = p_snapshot where id = existing;
    return existing;
  end if;
  perform set_config('seo.skip_report_email', '1', true);
  insert into public.client_portal_report_shares (organization_id, client_id, report_id, snapshot)
    values (p_org, p_client, p_report, p_snapshot)
    returning id into existing;
  return existing;
end $$;

revoke all on function public.publish_frozen_report_share(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.publish_frozen_report_share(uuid, uuid, uuid, jsonb) to service_role;
