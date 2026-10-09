-- 077: immutable report versions and the approval state machine.
-- 075 is reserved and unused. This file does not take it.
--
-- Storage: two empty tables. Nothing is backfilled. A JSON snapshot is written
-- only when someone approves or corrects a report. Existing reports, shares,
-- and metrics are not updated.
--
-- report_versions cannot be updated or deleted. report_reviews can move only
-- through draft → ready_for_review → approved → scheduled → sent, plus the
-- correction edges back to approved or ready_for_review.
--
-- Authenticated users can read rows in their own organizations. Writes are
-- service-role only, and every route still checks membership before it writes.
--
-- Apply this file in the Supabase SQL editor before the app that calls it
-- is deployed.
--
-- Rollback:
-- drop trigger if exists report_versions_no_mutate on public.report_versions;
-- drop trigger if exists report_versions_belong on public.report_versions;
-- drop trigger if exists report_reviews_transition on public.report_reviews;
-- drop function if exists public.report_versions_immutable();
-- drop function if exists public.report_versions_belong();
-- drop function if exists public.enforce_report_review_transition();
-- drop table if exists public.report_reviews;
-- drop table if exists public.report_versions;

create table public.report_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  report_id uuid not null references public.reports(id) on delete restrict,
  version_no integer not null check (version_no >= 1),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null,
  reason text not null check (reason in ('approval', 'correction')),
  correction_note text,
  am_note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint report_versions_report_no_unique unique (report_id, version_no),
  constraint report_versions_snapshot_object check (
    jsonb_typeof(snapshot) = 'object'
    and pg_column_size(snapshot) <= 524288
  ),
  constraint report_versions_correction_note check (
    (reason = 'approval' and correction_note is null)
    or (reason = 'correction' and char_length(btrim(correction_note)) between 1 and 2000)
  ),
  constraint report_versions_am_note_length check (
    am_note is null or char_length(btrim(am_note)) between 1 and 2000
  )
);

create index report_versions_org_report_idx
  on public.report_versions (organization_id, report_id, version_no desc);

create table public.report_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  report_id uuid not null unique references public.reports(id) on delete restrict,
  state text not null default 'draft' check (
    state in ('draft', 'ready_for_review', 'approved', 'scheduled', 'sent')
  ),
  requires_owner_approval boolean not null default false,
  current_version_id uuid references public.report_versions(id),
  am_approved_by uuid references public.users(id) on delete set null,
  am_approved_at timestamptz,
  owner_approved_by uuid references public.users(id) on delete set null,
  owner_approved_at timestamptz,
  am_note text,
  recipient_contact_id uuid references public.client_portal_contacts(id) on delete set null,
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint report_reviews_am_note_length check (
    am_note is null or char_length(btrim(am_note)) between 1 and 2000
  )
);

create index report_reviews_org_state_idx
  on public.report_reviews (organization_id, state);

create or replace function public.report_versions_belong()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.reports r
    where r.id = new.report_id
      and r.organization_id = new.organization_id
      and r.client_id = new.client_id
  ) then
    raise exception 'The version does not belong to this report.'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger report_versions_belong
  before insert on public.report_versions
  for each row
  execute function public.report_versions_belong();

create or replace function public.report_versions_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'report_versions are immutable'
    using errcode = '55000';
end $$;

create trigger report_versions_no_mutate
  before update or delete on public.report_versions
  for each row
  execute function public.report_versions_immutable();

create or replace function public.enforce_report_review_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.state is distinct from 'draft'
       or new.current_version_id is not null
       or new.am_approved_by is not null
       or new.owner_approved_by is not null
       or new.sent_at is not null then
      raise exception 'A review starts as a draft.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.client_id is distinct from old.client_id
     or new.report_id is distinct from old.report_id then
    raise exception 'A review cannot move to another report.'
      using errcode = '23514';
  end if;

  if new.state is distinct from old.state then
    if not (
      (old.state = 'draft' and new.state = 'ready_for_review')
      or (old.state = 'ready_for_review' and new.state = 'draft')
      or (old.state = 'ready_for_review' and new.state = 'approved')
      or (old.state = 'approved' and new.state = 'scheduled')
      or (old.state = 'approved' and new.state = 'ready_for_review')
      or (old.state = 'scheduled' and new.state = 'approved')
      or (old.state = 'scheduled' and new.state = 'ready_for_review')
      or (old.state = 'scheduled' and new.state = 'sent')
      or (old.state = 'sent' and new.state = 'approved')
      or (old.state = 'sent' and new.state = 'ready_for_review')
    ) then
      raise exception 'That review transition is not allowed.'
        using errcode = '23514';
    end if;
  end if;

  if new.state = 'draft' and (
    new.current_version_id is not null
    or new.am_approved_by is not null
    or new.owner_approved_by is not null
  ) then
    raise exception 'A draft has no approval.'
      using errcode = '23514';
  end if;

  if new.state in ('approved', 'scheduled', 'sent') then
    if new.am_approved_by is null or new.current_version_id is null then
      raise exception 'Approval needs an account manager and a frozen version.'
        using errcode = '23514';
    end if;
    if new.requires_owner_approval and new.owner_approved_by is null then
      raise exception 'This client needs the organization owner to approve.'
        using errcode = '23514';
    end if;
  end if;

  if new.state = 'scheduled' and new.recipient_contact_id is null then
    raise exception 'Scheduling waits for a portal recipient.'
      using errcode = '23514';
  end if;

  if new.state = 'sent' and new.sent_at is null then
    raise exception 'A sent review needs a sent time.'
      using errcode = '23514';
  end if;

  if new.current_version_id is not null and not exists (
    select 1
    from public.report_versions v
    where v.id = new.current_version_id
      and v.report_id = new.report_id
      and v.organization_id = new.organization_id
      and v.client_id = new.client_id
  ) then
    raise exception 'The frozen version does not belong to this report.'
      using errcode = '23514';
  end if;

  new.updated_at := timezone('utc', now());
  return new;
end $$;

create trigger report_reviews_transition
  before insert or update on public.report_reviews
  for each row
  execute function public.enforce_report_review_transition();

alter table public.report_versions enable row level security;
alter table public.report_reviews enable row level security;

create policy report_versions_select
  on public.report_versions for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

create policy report_reviews_select
  on public.report_reviews for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

revoke all on table public.report_versions from public, anon, authenticated;
revoke all on table public.report_reviews from public, anon, authenticated;
grant select on table public.report_versions to authenticated;
grant select on table public.report_reviews to authenticated;
grant all on table public.report_versions to service_role;
grant all on table public.report_reviews to service_role;
