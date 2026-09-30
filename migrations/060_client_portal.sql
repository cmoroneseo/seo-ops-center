-- =============================================================================
-- 060: Client portal v1
-- =============================================================================
-- Invite-only client contacts for one organization + client. They sign in with
-- a magic link and use /portal. They are NOT organization_members.
--
-- get_user_org_ids() is unchanged, so every existing staff policy stays closed
-- to these accounts. Portal reads and writes go through service-role routes
-- that resolve the caller from auth.uid() and the contact row — never from a
-- browser-supplied organization id.
--
-- Content batches stay on /review/[token]. This migration does not store raw
-- share tokens. The portal mints a fresh hashed link at the moment a signed-in
-- contact opens a batch that is already in review.
-- =============================================================================

create table public.client_portal_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  user_id uuid references public.users(id) on delete set null,
  invited_by uuid references public.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- One live contact per email per client. A revoked row can be reactivated.
create unique index client_portal_contacts_live_email_idx
  on public.client_portal_contacts (client_id, email)
  where revoked_at is null;

create index client_portal_contacts_user_idx
  on public.client_portal_contacts (user_id)
  where user_id is not null and revoked_at is null;

create index client_portal_contacts_org_idx
  on public.client_portal_contacts (organization_id, client_id);

alter table public.client_portal_contacts enable row level security;

-- Staff can see who was invited. Portal users can see only their own live rows
-- (middleware uses this to tell a client session from a staff session).
create policy client_portal_contacts_staff_select
  on public.client_portal_contacts for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

create policy client_portal_contacts_self_select
  on public.client_portal_contacts for select to authenticated
  using (user_id = auth.uid() and revoked_at is null);

revoke all on table public.client_portal_contacts from public, anon, authenticated;
grant select on table public.client_portal_contacts to authenticated;
grant all on table public.client_portal_contacts to service_role;

-- ─── Invites ────────────────────────────────────────────────────────────────
-- Same shape as organization_invites: store the sha-256 of the token, consume
-- once, service role only. Consuming a portal invite never inserts a membership.

create table public.client_portal_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (length(token_hash) = 64),
  contact_id uuid not null references public.client_portal_contacts(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  invited_by uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index client_portal_invites_expiry_idx
  on public.client_portal_invites (expires_at)
  where consumed_at is null;

alter table public.client_portal_invites enable row level security;

revoke all on table public.client_portal_invites from public, anon, authenticated;
grant all on table public.client_portal_invites to service_role;

create or replace function public.consume_client_portal_invite(
  p_token_hash text,
  p_user_id uuid,
  p_email text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  invitation public.client_portal_invites%rowtype;
  contact public.client_portal_contacts%rowtype;
  normalized_email text;
begin
  if auth.role() is distinct from 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;

  normalized_email := lower(btrim(coalesce(p_email, '')));

  select * into invitation
  from public.client_portal_invites
  where token_hash = p_token_hash
  for update;

  if not found
     or invitation.consumed_at is not null
     or invitation.expires_at <= timezone('utc', now())
     or normalized_email = ''
     or invitation.email <> normalized_email then
    return false;
  end if;

  select * into contact
  from public.client_portal_contacts
  where id = invitation.contact_id
  for update;

  if not found
     or contact.revoked_at is not null
     or contact.email <> invitation.email
     or contact.organization_id is distinct from invitation.organization_id
     or contact.client_id is distinct from invitation.client_id
     or (contact.user_id is not null and contact.user_id is distinct from p_user_id) then
    return false;
  end if;

  insert into public.users (id, email)
  values (p_user_id, normalized_email)
  on conflict (id) do nothing;

  update public.client_portal_contacts
  set user_id = p_user_id,
      updated_at = timezone('utc', now())
  where id = contact.id;

  update public.client_portal_invites
  set consumed_at = timezone('utc', now()),
      consumed_by = p_user_id
  where id = invitation.id
    and consumed_at is null;

  return found;
end;
$$;

revoke all on function public.consume_client_portal_invite(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.consume_client_portal_invite(text, uuid, text)
  to service_role;

-- ─── SEO Plan share + decision ──────────────────────────────────────────────
-- A plan is invisible in the portal until a staff member shares it. Decisions
-- are append-only. Asking the client to look again bumps approval_requested_at
-- so an older approval no longer counts as the current answer.

create table public.client_portal_plan_shares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  marketing_plan_id uuid not null references public.marketing_plans(id) on delete cascade,
  shared_by uuid references public.users(id) on delete set null,
  shared_at timestamptz not null default timezone('utc', now()),
  approval_requested_at timestamptz not null default timezone('utc', now()),
  unshared_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index client_portal_plan_shares_live_idx
  on public.client_portal_plan_shares (marketing_plan_id)
  where unshared_at is null;

create index client_portal_plan_shares_client_idx
  on public.client_portal_plan_shares (client_id)
  where unshared_at is null;

create table public.client_portal_plan_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  marketing_plan_id uuid not null references public.marketing_plans(id) on delete cascade,
  contact_id uuid not null references public.client_portal_contacts(id) on delete cascade,
  actor_label text not null check (char_length(btrim(actor_label)) between 1 and 80),
  decision text not null check (decision in ('approved', 'changes_requested')),
  note text check (note is null or char_length(note) between 1 and 2000),
  decided_at timestamptz not null default timezone('utc', now())
);

create index client_portal_plan_decisions_plan_idx
  on public.client_portal_plan_decisions (marketing_plan_id, decided_at desc);

-- ─── Report shares ──────────────────────────────────────────────────────────
-- Only a published report can be shared. The API enforces that; the portal
-- also refuses drafts even if a share row exists.

create table public.client_portal_report_shares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  report_id uuid not null references public.reports(id) on delete cascade,
  shared_by uuid references public.users(id) on delete set null,
  shared_at timestamptz not null default timezone('utc', now()),
  unshared_at timestamptz
);

create unique index client_portal_report_shares_live_idx
  on public.client_portal_report_shares (report_id)
  where unshared_at is null;

create index client_portal_report_shares_client_idx
  on public.client_portal_report_shares (client_id)
  where unshared_at is null;

-- ─── Waiting on the client ──────────────────────────────────────────────────
-- Staff write the client-facing title and detail. This is not a copy of
-- deliverable notes, assignees, or task comments.

create table public.client_portal_waiting_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  deliverable_id uuid references public.deliverables(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 140),
  detail text check (detail is null or char_length(detail) between 1 and 2000),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz
);

create index client_portal_waiting_items_open_idx
  on public.client_portal_waiting_items (client_id, created_at desc)
  where resolved_at is null;

-- ─── Lightweight feedback ───────────────────────────────────────────────────
-- Threads hang off the shared plan or an open waiting item. Not a ticket system.

create table public.client_portal_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid not null references public.client_portal_contacts(id) on delete cascade,
  author_label text not null check (char_length(btrim(author_label)) between 1 and 80),
  subject_type text not null check (subject_type in ('plan', 'waiting_item')),
  subject_id uuid not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default timezone('utc', now())
);

create index client_portal_feedback_subject_idx
  on public.client_portal_feedback (client_id, subject_type, subject_id, created_at);

alter table public.client_portal_plan_shares enable row level security;
alter table public.client_portal_plan_decisions enable row level security;
alter table public.client_portal_report_shares enable row level security;
alter table public.client_portal_waiting_items enable row level security;
alter table public.client_portal_feedback enable row level security;

-- Staff can read portal activity for their org. Writes stay on the service
-- role so a portal session cannot insert a decision for another client.
create policy client_portal_plan_shares_staff_select
  on public.client_portal_plan_shares for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

create policy client_portal_plan_decisions_staff_select
  on public.client_portal_plan_decisions for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

create policy client_portal_report_shares_staff_select
  on public.client_portal_report_shares for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

create policy client_portal_waiting_items_staff_select
  on public.client_portal_waiting_items for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

create policy client_portal_feedback_staff_select
  on public.client_portal_feedback for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

revoke all on table public.client_portal_plan_shares from public, anon, authenticated;
revoke all on table public.client_portal_plan_decisions from public, anon, authenticated;
revoke all on table public.client_portal_report_shares from public, anon, authenticated;
revoke all on table public.client_portal_waiting_items from public, anon, authenticated;
revoke all on table public.client_portal_feedback from public, anon, authenticated;

grant select on table public.client_portal_plan_shares to authenticated;
grant select on table public.client_portal_plan_decisions to authenticated;
grant select on table public.client_portal_report_shares to authenticated;
grant select on table public.client_portal_waiting_items to authenticated;
grant select on table public.client_portal_feedback to authenticated;

grant all on table public.client_portal_plan_shares to service_role;
grant all on table public.client_portal_plan_decisions to service_role;
grant all on table public.client_portal_report_shares to service_role;
grant all on table public.client_portal_waiting_items to service_role;
grant all on table public.client_portal_feedback to service_role;
