-- =============================================================================
-- seo-ops-center — canonical database schema
-- =============================================================================
-- This is the from-scratch schema for a fresh Supabase project. It already
-- incorporates the fixes shipped as incremental migrations against the live DB:
--   migrations/001_init_seo_ops_schema.sql  (full schema + complete RLS policies)
--   migrations/002_fix_rls_policies.sql      (org read-back + members recursion fix)
--   migrations/003_seo_ops_domain.sql        (clients master record + deliverables,
--                                             client_change_log, team_bonus, is_internal)
--   migrations/004_client_integrations.sql  (client_integrations, sync_runs,
--                                             extends metrics with client_id/metric_month)
-- Running this file on an empty project yields the same state as 001–004.
-- =============================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Organizations (Tenants)
create table public.organizations (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  slug text unique not null,
  stripe_customer_id text,
  subscription_status text check (subscription_status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')) default 'trialing',
  plan_type text check (plan_type in ('starter', 'pro', 'agency', 'enterprise')) default 'starter',
  -- Internal/comp orgs (e.g. Marketing Empire Group) bypass plan limits & billing.
  is_internal boolean not null default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  -- Records the creating user so they can read the org back immediately on
  -- creation (before the membership row exists). FK attached after users table.
  created_by uuid default auth.uid(),
  -- Brand theme selection (migration 039): {"preset":"<id>"} or
  -- {"preset":"custom","hex":"#rrggbb"}. Null = shipped default.
  -- Token set is derived in lib/theme/palette.ts, not stored here.
  theme jsonb
);

-- 2. Users (extends Supabase auth.users)
create table public.users (
  id uuid references auth.users on delete cascade not null primary key,
  email text not null,
  full_name text,
  avatar_url text,
  system_role text check (system_role in ('admin', 'user')) default 'user',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Attach organizations.created_by FK now that public.users exists
alter table public.organizations
  add constraint organizations_created_by_fkey
  foreign key (created_by) references public.users(id);

-- 3. Organization Members (Many-to-Many: Users <-> Orgs)
create table public.organization_members (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  role text check (role in ('owner', 'admin', 'member', 'viewer')) default 'member',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(organization_id, user_id)
);

-- Durable, one-time organization onboarding grants. No browser policies are
-- defined; creation and consumption happen only through authorized server paths.
create table public.organization_invites (
  id uuid default uuid_generate_v4() primary key,
  token_hash text not null unique check (length(token_hash) = 64),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  role text not null default 'member' check (role in ('member', 'viewer')),
  invited_by uuid not null references public.users(id) on delete cascade,
  expires_at timestamp with time zone not null,
  consumed_at timestamp with time zone,
  consumed_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);
create index organization_invites_expiry_idx
  on public.organization_invites (expires_at) where consumed_at is null;

-- OAuth state is persisted so callback replay is rejected across instances.
create table public.basecamp_oauth_states (
  state_hash text primary key check (length(state_hash) = 64),
  user_id uuid not null references public.users(id) on delete cascade,
  return_to text not null,
  expires_at timestamp with time zone not null,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);
create index basecamp_oauth_states_expiry_idx
  on public.basecamp_oauth_states (expires_at) where consumed_at is null;

-- 4. Clients/Companies (Belong to an Organization)
-- The master "Client Overview" record (also absorbs Client Campaigns + Analytics
-- Map fields). Derived values (actual blogs due, delivered, on-track status) are
-- computed in app code, never stored. See docs/seo-ops-migration-spec.md.
create table public.clients (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  name text not null,
  domain text,
  logo_url text,
  status text check (status in ('active', 'inactive', 'pending', 'paused', 'onboarding')) default 'active',
  -- Workbook import join key: lowercased-alphanumeric of name. Not user-facing.
  client_slug text,
  -- Engagement / budget
  launch_date date,
  original_launch_date date,
  launch_date_override date,
  seo_hours numeric(6, 2),
  engagement_model text check (engagement_model is null or engagement_model in ('Retainer', 'Campaign')),
  deliverables_spec text,                         -- raw cadence string, e.g. '2x/month'
  blogs_due_per_month numeric(4, 1),              -- parsed from deliverables_spec, then editable
  account_manager_id uuid references public.users(id),
  account_manager_name text,                      -- fallback when no user row yet
  tier smallint check (tier is null or tier in (1, 2, 3)),
  target_blog_count integer,
  delivered_override integer,
  notes text,
  planning_tags text,
  -- Campaign engagement (only meaningful when engagement_model = 'Campaign')
  campaign_start date,
  campaign_end date,
  campaign_total_blogs integer,
  campaign_total_hours numeric(7, 2),
  -- Analytics map (stored for the later live-data phase; no UI yet)
  ga4_property_id text,
  gsc_url text,
  -- Ad-hoc / lossless-import columns (spreadsheet-style flexibility)
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
-- Non-partial so it can serve as an upsert ON CONFLICT target for the workbook
-- importer. NULL slugs are distinct in Postgres, so non-imported clients don't collide.
create unique index clients_org_slug_uniq
  on public.clients (organization_id, client_slug);

-- 5. Projects (One client can have multiple projects/sites)
create table public.projects (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  name text not null,
  settings jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Tasks
create table public.tasks (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete cascade not null,
  title text not null,
  description text,
  status text check (status in ('todo', 'in_progress', 'review', 'done')) default 'todo',
  assignee_id uuid references public.users(id),
  due_date timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 7. Metrics (SEO Data)
create table public.metrics (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete cascade not null,
  date date not null,
  source text check (source in ('gsc', 'ga4')),
  data jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 8. Reports
-- Rebuilt by migration 008 (replaces the 001 project_id-keyed stub);
-- client_id made nullable by migration 023 (reports start unassigned).
create table public.reports (
  id                uuid default uuid_generate_v4() primary key,
  organization_id   uuid references public.organizations(id) on delete cascade not null,
  client_id         uuid references public.clients(id) on delete cascade,
  report_month      text not null,          -- 'YYYY-MM'
  title             text not null,
  executive_summary text,
  recommendations   text,
  sections          jsonb default '[]'::jsonb not null, -- v2 BlocksDoc
  status            text default 'draft'
                    check (status in ('draft', 'published')),
  created_by        uuid references public.users(id),
  created_at        timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at        timestamp with time zone default timezone('utc'::text, now()) not null,
  pdf_url           text
);
create index reports_org_client_idx on public.reports (organization_id, client_id, report_month desc);

alter table public.reports enable row level security;

create policy "Org members can view reports"
  on public.reports for select
  using ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage reports"
  on public.reports for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

-- 9. Subscriptions (Synced from Stripe)
create table public.subscriptions (
  id text primary key, -- Stripe Subscription ID
  organization_id uuid references public.organizations(id) on delete cascade not null,
  status text check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid')),
  price_id text,
  quantity integer,
  cancel_at_period_end boolean,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 10. Monthly Plans (Forecasting)
create table public.monthly_plans (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  month text not null, -- YYYY-MM
  weeks jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(client_id, month)
);

-- 11. Time Logs
create table public.time_logs (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  date date not null default current_date,
  hours numeric(5, 2) not null,
  description text,
  billable boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  -- migration 010: timer support
  status text not null default 'logged' check (status in ('in_progress', 'logged', 'needs_review')),
  timer_started_at timestamp with time zone,
  elapsed_seconds integer not null default 0,
  category text,
  -- migration 011: in-session notes
  session_notes jsonb not null default '[]'::jsonb,
  -- migration 026: Basecamp timesheet sync
  basecamp_entry_id bigint,
  basecamp_project_id bigint,
  -- migration 032: protected provider recording provenance
  basecamp_recording_id bigint,
  basecamp_synced_at timestamp with time zone,
  basecamp_sync_error text,
  -- migration 033: planner actual-time attempt state
  planned_starts_at timestamptz,
  planned_minutes integer,
  reviewing_at timestamptz,
  operation_id uuid,
  -- migration 036: idempotency for planner completion logging
  completion_operation_id uuid
);

-- 12. Usage Logs (For Metered Features like AI Reports)
create table public.usage_logs (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  feature_name text not null,
  quantity integer default 1,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 13. Deliverables (Deliverables Tracker). Single status cell becomes a real
-- lifecycle; status_history enables cycle-time analytics a sheet can't produce.
create table public.deliverables (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  title text not null,
  type text check (type in ('Content', 'Backlink', 'GBP', 'Other')) default 'Content',
  status text check (status in ('Pending', 'In Progress', 'Review', 'Approved', 'Published')) default 'Pending',
  due_date date,
  month text,                                     -- 'YYYY-MM' for monthly rollups
  account_manager_id uuid references public.users(id),
  counts_toward_hours boolean default true,
  notes text,
  delivered_on timestamp with time zone,
  status_history jsonb not null default '[]'::jsonb,
  custom_fields jsonb not null default '{}'::jsonb,
  -- Commitment-driven fulfillment (migration 015)
  commitment_id uuid,                             -- FK added after deliverable_commitments below
  assignee_id uuid references public.users(id),
  published_url text,
  word_count integer,
  subtype text,
  generated_by text check (generated_by is null or generated_by in ('manual', 'cron', 'import')) default 'manual',
  sequence_in_month smallint,                     -- "Blog 2 of 4"
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index deliverables_client_month_idx on public.deliverables (client_id, month);
create index deliverables_org_idx on public.deliverables (organization_id);
create index deliverables_commitment_month_idx on public.deliverables (commitment_id, month);
create index deliverables_assignee_idx on public.deliverables (assignee_id) where assignee_id is not null;

-- 14. Client Change Log. Written automatically by a trigger (see bottom of file)
-- when seo_hours / blogs_due_per_month change — no more hand-typed entries.
create table public.client_change_log (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  date_of_change timestamp with time zone default timezone('utc'::text, now()) not null,
  changed_by_id uuid references public.users(id),
  prev_seo_hours numeric(6, 2),
  new_seo_hours numeric(6, 2),
  prev_blog_count numeric(4, 1),
  new_blog_count numeric(4, 1),
  effective_date date,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index client_change_log_client_idx on public.client_change_log (client_id);

-- 15. Team Bonus (SEO Team Bonus Tracker). Compensation data — RLS restricts to
-- org owner/admin only. total_bonus = MIN(base + kpi, cap), computed in app code.
create table public.team_bonus (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id),
  member_name text,                               -- fallback when no user row yet
  month text not null,                            -- 'YYYY-MM'
  base_from_hours numeric(8, 2) default 0,
  kpi_bonus numeric(8, 2) default 0,
  cap numeric(8, 2) default 300,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index team_bonus_org_month_idx on public.team_bonus (organization_id, month);

-- 16. Deliverable Commitments (migration 015). The contract layer: what each
-- client agreement promises per month ("2 blogs/month"). A daily cron generates
-- the month's rows in public.deliverables (the fulfillment layer) from these.
create table public.deliverable_commitments (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  type text not null check (type in ('Content', 'Backlink', 'GBP', 'Other')) default 'Content',
  subtype text,                                   -- 'blog' | 'service_page' | 'city_page' | 'landing_page' |
                                                  -- 'link_building' | 'gbp_management' | 'technical_seo' | custom
  title text not null,                            -- display name, e.g. "Blog Posts"
  quantity_per_month numeric(5, 1) not null default 1,
  cadence text not null default 'monthly' check (cadence in ('monthly', 'quarterly', 'one_time')),
  engagement_model text not null default 'Retainer' check (engagement_model in ('Retainer', 'Campaign')),
  total_quantity integer,                         -- campaign cap; null for open-ended retainers
  starts_on date not null,
  ends_on date,                                   -- null = open-ended
  is_active boolean not null default true,
  default_assignee_id uuid references public.users(id),
  due_day smallint check (due_day between 1 and 28),
  counts_toward_hours boolean default true,
  task_template_id uuid references public.task_templates(id) on delete set null,
  generate_tasks boolean not null default false,  -- Phase 2: auto-create production tasks
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index deliverable_commitments_client_idx on public.deliverable_commitments (client_id, is_active);
create index deliverable_commitments_org_idx on public.deliverable_commitments (organization_id);

-- Late FK: deliverables.commitment_id (declared before the commitments table exists).
alter table public.deliverables
  add constraint deliverables_commitment_id_fkey
  foreign key (commitment_id) references public.deliverable_commitments(id) on delete set null;

-- 17. Commitment Change Log (migration 015). Audit trail for agreement changes,
-- written automatically by a trigger (see bottom of file).
create table public.commitment_change_log (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  commitment_id uuid references public.deliverable_commitments(id) on delete set null,
  changed_by_id uuid references public.users(id),
  change_type text not null check (change_type in ('created', 'quantity', 'dates', 'paused', 'resumed', 'ended')),
  prev_values jsonb,
  new_values jsonb,
  effective_date date,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index commitment_change_log_client_idx on public.commitment_change_log (client_id, created_at desc);


-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invites enable row level security;
alter table public.basecamp_oauth_states enable row level security;
alter table public.users                enable row level security;
alter table public.clients              enable row level security;
alter table public.projects             enable row level security;
alter table public.tasks                enable row level security;
alter table public.metrics              enable row level security;
alter table public.reports              enable row level security;
alter table public.subscriptions        enable row level security;
alter table public.monthly_plans        enable row level security;
alter table public.time_logs            enable row level security;
alter table public.usage_logs           enable row level security;
alter table public.deliverables         enable row level security;
alter table public.client_change_log    enable row level security;
alter table public.team_bonus           enable row level security;
alter table public.deliverable_commitments enable row level security;
alter table public.commitment_change_log   enable row level security;

-- Helper: org ids the current user belongs to.
-- SECURITY DEFINER so it bypasses RLS internally (prevents recursion when used
-- inside policies on organization_members).
create or replace function get_user_org_ids()
returns setof uuid as $$
  select organization_id from public.organization_members
  where user_id = auth.uid()
$$ language sql security definer;

-- Helper: org ids where the current user is owner/admin.
create or replace function public.get_user_admin_org_ids()
returns setof uuid as $$
  select organization_id from public.organization_members
  where user_id = auth.uid() and role in ('owner', 'admin')
$$ language sql security definer;

-- --- Organizations ---
create policy "Users can view organizations they are members of"
  on public.organizations for select
  using ( id in (select get_user_org_ids()) );

-- Lets the creator read the org back on insert().select(), before membership exists.
create policy "Creators can view their organizations"
  on public.organizations for select
  using ( created_by = auth.uid() );

create policy "Authenticated users can create organizations"
  on public.organizations for insert
  to authenticated
  with check ( created_by = auth.uid() and is_internal = false );

create policy "Owners can update their own organizations"
  on public.organizations for update
  using (
    id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- --- Organization members ---
create policy "Users can view members in their organizations"
  on public.organization_members for select
  using ( organization_id in (select get_user_org_ids()) );

-- Owner bootstrap is deliberately narrower than an INSERT policy: the function
-- fixes user and role and accepts only an organization created by that user.
create or replace function public.bootstrap_organization_owner(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  organization public.organizations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into organization
  from public.organizations
  where id = p_organization_id
  for update;
  if not found or organization.created_by is distinct from auth.uid() then
    raise exception 'organization owner bootstrap denied' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id
  ) then
    raise exception 'organization owner already bootstrapped' using errcode = '42501';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (p_organization_id, auth.uid(), 'owner');
end;
$$;
revoke all on function public.bootstrap_organization_owner(uuid) from public, anon;
grant execute on function public.bootstrap_organization_owner(uuid) to authenticated;

create or replace function public.consume_organization_invite(
  p_token_hash text,
  p_user_id uuid,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  invitation public.organization_invites%rowtype;
begin
  if auth.role() is distinct from 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select * into invitation
  from public.organization_invites
  where token_hash = p_token_hash
  for update;

  if not found
     or invitation.consumed_at is not null
     or invitation.expires_at <= now()
     or p_email is null
     or invitation.email <> lower(btrim(p_email)) then
    return false;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (invitation.organization_id, p_user_id, invitation.role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invites
  set consumed_at = now(), consumed_by = p_user_id
  where id = invitation.id and consumed_at is null;
  return found;
end;
$$;
revoke all on function public.consume_organization_invite(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.consume_organization_invite(text, uuid, text) to service_role;

-- Uses the SECURITY DEFINER helper to avoid infinite recursion (the previous
-- version queried organization_members from within a policy on the same table).
create policy "Owners and Admins can manage organization members"
  on public.organization_members for all
  using      ( organization_id in (select public.get_user_admin_org_ids()) )
  with check ( organization_id in (select public.get_user_admin_org_ids()) );

-- --- Users ---
create policy "Users can view all public profiles"
  on public.users for select
  using ( true );

-- --- Org-scoped resource tables: members get full access within their org ---
create policy "Org members can manage clients"
  on public.clients for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

-- Trust-sensitive provider authorization state remains service-role controlled
-- even though owners/members may update other organization/client fields. These
-- guards preserve all existing values and reject only future browser changes.
create or replace function public.protect_organization_internal_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' and new.is_internal is distinct from false then
    raise exception 'organizations.is_internal is server-controlled'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.is_internal is distinct from old.is_internal then
    raise exception 'organizations.is_internal is server-controlled'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger protect_organization_internal_status
  before insert or update on public.organizations
  for each row execute function public.protect_organization_internal_status();

create or replace function public.protect_client_basecamp_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  old_basecamp_fields jsonb := '{}'::jsonb;
  new_basecamp_fields jsonb := '{}'::jsonb;
begin
  if auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if jsonb_typeof(coalesce(new.custom_fields, '{}'::jsonb)) <> 'object' then
    raise exception 'clients.custom_fields must be a JSON object'
      using errcode = '22023';
  end if;

  if tg_op = 'UPDATE'
     and jsonb_typeof(coalesce(old.custom_fields, '{}'::jsonb)) = 'object' then
    select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
      into old_basecamp_fields
      from jsonb_each(coalesce(old.custom_fields, '{}'::jsonb)) as entry
      where entry.key like 'basecamp\_%' escape '\';
  end if;

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    into new_basecamp_fields
    from jsonb_each(coalesce(new.custom_fields, '{}'::jsonb)) as entry
    where entry.key like 'basecamp\_%' escape '\';

  if new_basecamp_fields is distinct from old_basecamp_fields then
    raise exception 'clients.custom_fields Basecamp keys are server-controlled'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger protect_client_basecamp_fields
  before insert or update of custom_fields on public.clients
  for each row execute function public.protect_client_basecamp_fields();

create or replace function public.protect_task_basecamp_linkage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT'
     and (new.basecamp_todo_id is not null or new.basecamp_project_id is not null) then
    raise exception 'task Basecamp linkage is server-controlled'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and (new.basecamp_todo_id is distinct from old.basecamp_todo_id
          or new.basecamp_project_id is distinct from old.basecamp_project_id) then
    raise exception 'task Basecamp linkage is server-controlled'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger protect_task_basecamp_linkage
  before insert or update of basecamp_todo_id, basecamp_project_id on public.tasks
  for each row execute function public.protect_task_basecamp_linkage();

create or replace function public.protect_time_log_basecamp_tuple()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT'
     and (new.basecamp_entry_id is not null or new.basecamp_recording_id is not null) then
    raise exception 'time log Basecamp linkage is server-controlled'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and (
       new.basecamp_entry_id is distinct from old.basecamp_entry_id
       or new.basecamp_recording_id is distinct from old.basecamp_recording_id
       or ((old.basecamp_entry_id is not null or old.basecamp_recording_id is not null)
           and new.basecamp_project_id is distinct from old.basecamp_project_id)
     ) then
    raise exception 'time log Basecamp linkage is server-controlled'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger protect_time_log_basecamp_tuple
  before insert or update of basecamp_entry_id, basecamp_project_id, basecamp_recording_id
  on public.time_logs
  for each row execute function public.protect_time_log_basecamp_tuple();

create policy "Org members can manage projects"
  on public.projects for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage tasks"
  on public.tasks for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage metrics"
  on public.metrics for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage reports"
  on public.reports for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage monthly_plans"
  on public.monthly_plans for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage time_logs"
  on public.time_logs for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage deliverables"
  on public.deliverables for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage client_change_log"
  on public.client_change_log for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage deliverable_commitments"
  on public.deliverable_commitments for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage commitment_change_log"
  on public.commitment_change_log for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

-- Team bonus: compensation data — owner/admin only (members/viewers cannot read).
create policy "Admins can manage team_bonus"
  on public.team_bonus for all
  using      ( organization_id in (select public.get_user_admin_org_ids()) )
  with check ( organization_id in (select public.get_user_admin_org_ids()) );

-- Subscriptions: read-only for members (writes happen via Stripe webhook / service role).
create policy "Org members can view subscriptions"
  on public.subscriptions for select
  using ( organization_id in (select get_user_org_ids()) );

-- Usage logs: read-only for members (writes are server-side / metered).
create policy "Org members can view usage_logs"
  on public.usage_logs for select
  using ( organization_id in (select get_user_org_ids()) );


-- =============================================================================
-- User sync trigger: create a public.users row when someone signs up via Auth
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- =============================================================================
-- Auto change-log: record a client_change_log row when a client's budget or
-- blog cadence changes. Replaces the hand-typed "Client Change Log" sheet.
-- The bulk importer sets app.suppress_change_log='on' to skip this during the
-- one-time historical load (those rows are inserted explicitly).
-- =============================================================================
create or replace function public.log_client_change()
returns trigger as $$
begin
  if coalesce(current_setting('app.suppress_change_log', true), 'off') = 'on' then
    return new;
  end if;

  if new.seo_hours is distinct from old.seo_hours
     or new.blogs_due_per_month is distinct from old.blogs_due_per_month then
    insert into public.client_change_log (
      organization_id, client_id, changed_by_id,
      prev_seo_hours, new_seo_hours, prev_blog_count, new_blog_count, effective_date
    ) values (
      new.organization_id, new.id, auth.uid(),
      old.seo_hours, new.seo_hours, old.blogs_due_per_month, new.blogs_due_per_month,
      current_date
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_client_budget_change on public.clients;
create trigger on_client_budget_change
  after update on public.clients
  for each row execute procedure public.log_client_change();


-- =============================================================================
-- Auto change-log: record a commitment_change_log row when an agreement's
-- deliverable commitment is created or its quantity/dates/active state change.
-- Same suppress GUC as log_client_change for bulk imports.
-- =============================================================================
create or replace function public.log_commitment_change()
returns trigger as $$
declare
  v_change_type text;
begin
  if coalesce(current_setting('app.suppress_change_log', true), 'off') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.commitment_change_log (
      organization_id, client_id, commitment_id, changed_by_id,
      change_type, new_values, effective_date
    ) values (
      new.organization_id, new.client_id, new.id, auth.uid(),
      'created',
      jsonb_build_object(
        'type', new.type, 'subtype', new.subtype, 'title', new.title,
        'quantity_per_month', new.quantity_per_month, 'cadence', new.cadence,
        'starts_on', new.starts_on, 'ends_on', new.ends_on, 'total_quantity', new.total_quantity
      ),
      new.starts_on
    );
    return new;
  end if;

  if new.is_active is distinct from old.is_active then
    v_change_type := case when new.is_active then 'resumed' else 'paused' end;
  elsif new.ends_on is not null and old.ends_on is null then
    v_change_type := 'ended';
  elsif new.quantity_per_month is distinct from old.quantity_per_month
     or new.total_quantity is distinct from old.total_quantity then
    v_change_type := 'quantity';
  elsif new.starts_on is distinct from old.starts_on
     or new.ends_on is distinct from old.ends_on then
    v_change_type := 'dates';
  else
    return new;
  end if;

  insert into public.commitment_change_log (
    organization_id, client_id, commitment_id, changed_by_id,
    change_type, prev_values, new_values, effective_date
  ) values (
    new.organization_id, new.client_id, new.id, auth.uid(),
    v_change_type,
    jsonb_build_object(
      'quantity_per_month', old.quantity_per_month, 'total_quantity', old.total_quantity,
      'starts_on', old.starts_on, 'ends_on', old.ends_on, 'is_active', old.is_active
    ),
    jsonb_build_object(
      'quantity_per_month', new.quantity_per_month, 'total_quantity', new.total_quantity,
      'starts_on', new.starts_on, 'ends_on', new.ends_on, 'is_active', new.is_active
    ),
    current_date
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_commitment_change on public.deliverable_commitments;
create trigger on_commitment_change
  after insert or update on public.deliverable_commitments
  for each row execute procedure public.log_commitment_change();


-- =============================================================================
-- Campaign Plans (migration 019)
-- =============================================================================

create table public.campaign_plans (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  status text not null default 'draft'
    check (status in ('draft', 'internal_review', 'approved', 'active', 'archived')),
  title text not null,
  summary text,
  strategy_model text
    check (strategy_model is null or strategy_model in (
      'authority_relevance_trust', 'custom', 'local', 'ecommerce', 'saas', 'other'
    )),
  start_date date,
  target_review_date date,
  created_by_id uuid references public.users(id),
  approved_by_id uuid references public.users(id),
  approved_at timestamp with time zone,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index campaign_plans_client_idx on public.campaign_plans (client_id);
create index campaign_plans_org_idx on public.campaign_plans (organization_id);

create table public.campaign_goals (
  id uuid default uuid_generate_v4() primary key,
  campaign_plan_id uuid references public.campaign_plans(id) on delete cascade not null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  title text not null,
  category text
    check (category is null or category in (
      'leads', 'sales', 'local_visibility', 'authority', 'traffic',
      'content_moat', 'launch_support', 'reputation', 'other'
    )),
  description text,
  priority smallint default 0,
  owner_id uuid references public.users(id),
  status text not null default 'active'
    check (status in ('active', 'achieved', 'at_risk', 'dropped')),
  sort_order smallint not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index campaign_goals_plan_idx on public.campaign_goals (campaign_plan_id);

create table public.campaign_kpis (
  id uuid default uuid_generate_v4() primary key,
  campaign_goal_id uuid references public.campaign_goals(id) on delete cascade,
  campaign_plan_id uuid references public.campaign_plans(id) on delete cascade not null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  metric_name text not null,
  kpi_group text
    check (kpi_group is null or kpi_group in (
      'visibility', 'traffic', 'conversion', 'authority', 'content', 'technical'
    )),
  source text
    check (source is null or source in ('gsc', 'ga4', 'gbp', 'ahrefs', 'manual', 'internal')),
  baseline_value numeric,
  target_value numeric,
  target_range_min numeric,
  target_range_max numeric,
  target_date date,
  cadence text default 'monthly'
    check (cadence is null or cadence in ('weekly', 'monthly', 'quarterly')),
  confidence text default 'medium'
    check (confidence is null or confidence in ('low', 'medium', 'high')),
  measurement_notes text,
  sort_order smallint not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index campaign_kpis_plan_idx on public.campaign_kpis (campaign_plan_id);
create index campaign_kpis_goal_idx on public.campaign_kpis (campaign_goal_id);

create table public.campaign_workstreams (
  id uuid default uuid_generate_v4() primary key,
  campaign_plan_id uuid references public.campaign_plans(id) on delete cascade not null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  name text not null,
  category text
    check (category is null or category in (
      'research_strategy', 'technical_seo', 'on_page', 'content',
      'authority', 'local_seo', 'analytics', 'cro'
    )),
  status text not null default 'planned'
    check (status in ('planned', 'active', 'paused', 'completed')),
  priority smallint default 0,
  owner_id uuid references public.users(id),
  current_state text,
  target_state text,
  risks text,
  custom_fields jsonb not null default '{}'::jsonb,
  sort_order smallint not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index campaign_workstreams_plan_idx on public.campaign_workstreams (campaign_plan_id);

create table public.campaign_phases (
  id uuid default uuid_generate_v4() primary key,
  campaign_plan_id uuid references public.campaign_plans(id) on delete cascade not null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  name text not null,
  phase_order smallint not null default 0,
  start_date date,
  end_date date,
  objective text,
  exit_criteria text,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'active', 'completed', 'skipped')),
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index campaign_phases_plan_idx on public.campaign_phases (campaign_plan_id);

create table public.campaign_expectations (
  id uuid default uuid_generate_v4() primary key,
  campaign_plan_id uuid references public.campaign_plans(id) on delete cascade not null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  type text
    check (type is null or type in (
      'ranking', 'traffic', 'conversion', 'content', 'technical', 'authority', 'local'
    )),
  statement text not null,
  target_window_days integer,
  measurement_definition text,
  confidence text default 'medium'
    check (confidence is null or confidence in ('low', 'medium', 'high')),
  preconditions text,
  exclusions text,
  review_checkpoint_date date,
  escalation_rule text,
  approved_by_id uuid references public.users(id),
  approved_at timestamp with time zone,
  sort_order smallint not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index campaign_expectations_plan_idx on public.campaign_expectations (campaign_plan_id);

create table public.campaign_phase_workstreams (
  phase_id uuid references public.campaign_phases(id) on delete cascade not null,
  workstream_id uuid references public.campaign_workstreams(id) on delete cascade not null,
  primary key (phase_id, workstream_id)
);

-- Campaign phase FK on tasks
alter table public.tasks
  add column campaign_phase_id uuid references public.campaign_phases(id) on delete set null;
create index tasks_campaign_phase_idx on public.tasks (campaign_phase_id)
  where campaign_phase_id is not null;

-- RLS for campaign tables
alter table public.campaign_plans         enable row level security;
alter table public.campaign_goals         enable row level security;
alter table public.campaign_kpis          enable row level security;
alter table public.campaign_workstreams   enable row level security;
alter table public.campaign_phases        enable row level security;
alter table public.campaign_expectations  enable row level security;
alter table public.campaign_phase_workstreams enable row level security;

create policy "Org members can manage campaign_plans"
  on public.campaign_plans for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage campaign_goals"
  on public.campaign_goals for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage campaign_kpis"
  on public.campaign_kpis for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage campaign_workstreams"
  on public.campaign_workstreams for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage campaign_phases"
  on public.campaign_phases for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage campaign_expectations"
  on public.campaign_expectations for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage campaign_phase_workstreams"
  on public.campaign_phase_workstreams for all
  using (
    phase_id in (
      select id from public.campaign_phases
      where organization_id in (select get_user_org_ids())
    )
  )
  with check (
    phase_id in (
      select id from public.campaign_phases
      where organization_id in (select get_user_org_ids())
    )
  );

-- 021: marketing plans (SE Ranking-style checklist)

create table public.marketing_plans (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null unique,
  title text not null,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index marketing_plans_org_idx on public.marketing_plans (organization_id);

create table public.marketing_plan_items (
  id uuid default uuid_generate_v4() primary key,
  marketing_plan_id uuid references public.marketing_plans(id) on delete cascade not null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  step_key text not null,
  title text not null,
  description text,
  status text not null default 'todo'
    check (status in ('todo', 'done', 'ignored')),
  priority text not null default 'medium'
    check (priority in ('high', 'medium', 'low')),
  assignee_id uuid references public.users(id),
  due_date date,
  sort_order smallint not null default 0,
  comments jsonb not null default '[]'::jsonb,
  task_id uuid references public.tasks(id) on delete set null,
  is_custom boolean not null default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index marketing_plan_items_plan_idx on public.marketing_plan_items (marketing_plan_id);

-- Row Level Security
alter table public.marketing_plans       enable row level security;
alter table public.marketing_plan_items  enable row level security;

create policy "Org members can manage marketing_plans"
  on public.marketing_plans for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage marketing_plan_items"
  on public.marketing_plan_items for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

-- =============================================================================
-- Migration 022: Custom report templates ("My templates")
-- =============================================================================

create table public.report_templates (
  id              uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  name            text not null,
  blocks          jsonb default '[]'::jsonb not null, -- Block[] without ids
  created_by      uuid references public.users(id),
  created_at      timestamp with time zone default timezone('utc'::text, now()) not null
);
create index report_templates_org_idx on public.report_templates (organization_id, created_at desc);

alter table public.report_templates enable row level security;

create policy "Org members can view report templates"
  on public.report_templates for select
  using ( organization_id in (select get_user_org_ids()) );

create policy "Org members can manage report templates"
  on public.report_templates for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

-- =============================================================================
-- 024: Personal Notes — ClickUp-style personal notepad (UserMenu → Personal Tools)
-- =============================================================================
-- Strictly personal: RLS restricts rows to the creating user (auth.uid()),
-- not just the org. Rich text stored as HTML. task_id links a note promoted
-- to a real task (no completion sync back).
-- =============================================================================

create table public.personal_notes (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  title text not null default '',
  content_html text not null default '',
  task_id uuid references public.tasks(id) on delete set null,
  archived_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index personal_notes_user_idx on public.personal_notes (user_id, updated_at desc);

alter table public.personal_notes enable row level security;

create policy "Users can manage their own personal notes"
  on public.personal_notes for all
  using      ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) )
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

-- =============================================================================
-- 025: Personal Reminders — ClickUp-style reminders (UserMenu → Personal Tools)
-- =============================================================================
-- Strictly personal: RLS restricts rows to the creating user (auth.uid()).
-- A 5-minute Vercel cron (/api/cron/fire-reminders) turns due reminders into
-- bell notifications (type 'reminder_due'). Recurrence advances on completion.
-- notify_offset_minutes: 0 = notify on due date, N = notify N minutes before,
-- NULL = don't notify (reminder only shows in the panel).
-- =============================================================================

create table public.personal_reminders (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  title text not null,
  notes text,
  due_at timestamp with time zone not null,
  notify_offset_minutes integer default 0,
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  client_id uuid references public.clients(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'done', 'dismissed')),
  notified_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Cron sweep: pending, not-yet-notified reminders ordered by due time
create index personal_reminders_cron_idx
  on public.personal_reminders (due_at)
  where status = 'pending' and notified_at is null;

-- Panel queries: a user's reminders by status and due time
create index personal_reminders_user_idx
  on public.personal_reminders (user_id, status, due_at);

alter table public.personal_reminders enable row level security;

create policy "Users can manage their own personal reminders"
  on public.personal_reminders for all
  using      ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) )
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );
-- =============================================================================
-- 026: Weekly Planner — calendar events + the sidebar Priorities list
-- =============================================================================
-- planner_events is NOT strictly personal, unlike personal_notes and
-- personal_reminders: org members can read each other's non-private events so
-- the "Meet with <teammate>" filter can show their calendar. Writes stay
-- owner-only.
--
-- Scheduled tasks are NOT duplicated here. A task lands on the grid by having
-- tasks.start_date set; dragging it writes that column directly.
-- =============================================================================

create table public.planner_events (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  title text not null,
  description text,
  kind text not null default 'event' check (kind in ('meeting', 'focus', 'ooo', 'lunch', 'event')),
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  all_day boolean not null default false,
  location text,
  client_id uuid references public.clients(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  attendee_ids uuid[] not null default '{}',
  busy boolean not null default true,
  visibility text not null default 'default' check (visibility in ('default', 'private')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint planner_events_ends_after_starts check (ends_at > starts_at)
);

-- The week-range query: every visible event in an org between two timestamps
create index planner_events_org_range_idx
  on public.planner_events (organization_id, starts_at);

-- "My events"
create index planner_events_user_idx
  on public.planner_events (user_id, starts_at);

-- "Meet with" teammate filter
create index planner_events_attendees_idx
  on public.planner_events using gin (attendee_ids);

alter table public.planner_events enable row level security;

create policy "Org members can read visible planner events"
  on public.planner_events for select
  using (
    organization_id in (select get_user_org_ids())
    and (visibility = 'default' or user_id = auth.uid())
  );

create policy "Users can insert their own planner events"
  on public.planner_events for insert
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

create policy "Users can update their own planner events"
  on public.planner_events for update
  using      ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) )
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

create policy "Users can delete their own planner events"
  on public.planner_events for delete
  using ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

-- =============================================================================
-- planner_priorities — the reorderable Priorities list in the planner rail
-- =============================================================================
-- A priority is either a pinned real task (task_id) or free text (label).

create table public.planner_priorities (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  task_id uuid references public.tasks(id) on delete cascade,
  label text,
  sort_order integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint planner_priorities_needs_target check (task_id is not null or label is not null)
);

create index planner_priorities_user_idx
  on public.planner_priorities (user_id, sort_order);

alter table public.planner_priorities enable row level security;

create policy "Users can manage their own planner priorities"
  on public.planner_priorities for all
  using      ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) )
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

-- =============================================================================
-- 027: tasks.start_date -> timestamptz
-- =============================================================================
-- The planner time-blocks tasks on an hour grid, so a task's start needs a time
-- of day. As a `date` column it silently truncated 9:15 AM to a bare date, and
-- reading "2026-07-30" back through `new Date(...)` parsed it as UTC midnight —
-- which renders as the previous evening in any negative-UTC-offset zone (PDT),
-- so a task dropped on Thursday reappeared on Wednesday.
--
-- Existing date values convert to midnight UTC. `tasks.start_date` is read only
-- by the planner (`lib/planner/items.ts`), so nothing else is affected.
-- `due_date` stays a date — it is a deadline, not a scheduled block.
-- =============================================================================

alter table public.tasks
  alter column start_date type timestamp with time zone
  using start_date::timestamp with time zone;

-- =============================================================================
-- 028: tasks.scheduled_minutes — separate "time blocked" from "time estimated"
-- =============================================================================
-- The planner sized task blocks from estimated_hours and wrote back to it on
-- every drag and resize. Those are two different facts: estimated_hours is how
-- long the work takes, scheduled_minutes is how much of a given day you set
-- aside for it. Blocking one hour on Tuesday for a three-hour task must not
-- rewrite the estimate.
--
-- Null means "fall back to estimated_hours, then to one hour" — see
-- lib/planner/items.ts.
-- =============================================================================

alter table public.tasks
  add column if not exists scheduled_minutes integer;

-- =============================================================================
-- 030: time_logs — internal work, budget exclusion, and planner linkage
-- =============================================================================
-- Three changes, all driven by how the planner is actually used:
--
-- 1. client_id becomes nullable. An internal 1:1 has no client, so it could not
--    be logged at all before this — the column was NOT NULL.
--
-- 2. counts_toward_budget separates "we tracked this" from "this eats the
--    client's SEO hours". A client meeting is tracked and may well be billable,
--    but it must not consume deliverable budget. `billable` is a different
--    question (can we invoice it) and is left alone.
--
-- 3. planner_event_id links a log back to the calendar block that produced it,
--    so an event can show whether its time has been recorded.
-- =============================================================================

alter table public.time_logs
  alter column client_id drop not null;

alter table public.time_logs
  add column if not exists counts_toward_budget boolean not null default true;

alter table public.time_logs
  add column if not exists planner_event_id uuid
    references public.planner_events(id) on delete set null;

-- "Has this event been logged yet?" — one row per event in practice.
create index if not exists time_logs_planner_event_idx
  on public.time_logs (planner_event_id)
  where planner_event_id is not null;

-- The budget rollup filters on this, so it pairs with the existing client/date
-- access pattern.
create index if not exists time_logs_budget_idx
  on public.time_logs (client_id, date)
  where counts_toward_budget = true;

-- Existing rows are all client work logged before meetings were trackable, so
-- the `true` default is already correct for them.

-- =============================================================================
-- 033: Planner actual-time attempts and segments
-- =============================================================================
-- Additive persistence for task timer attempts. Forecast data is snapshotted on
-- the attempt, while actual work is represented by one or more closed/open
-- segments. All browser-callable transitions derive tenant and actor authority
-- from auth.uid() plus trusted database rows.
-- =============================================================================

alter table public.time_logs
  add column if not exists planned_starts_at timestamptz,
  add column if not exists planned_minutes integer,
  add column if not exists reviewing_at timestamptz,
  add column if not exists operation_id uuid;

alter table public.time_logs
  drop constraint if exists time_logs_planned_minutes_positive;
alter table public.time_logs
  add constraint time_logs_planned_minutes_positive
  check (planned_minutes is null or planned_minutes > 0);

alter table public.client_activity_log
  add column if not exists operation_id uuid;

create index if not exists client_activity_log_operation_idx
  on public.client_activity_log (client_id, operation_id)
  where operation_id is not null;

create table if not exists public.time_log_segments (
  id uuid primary key default uuid_generate_v4(),
  time_log_id uuid not null references public.time_logs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint time_log_segments_positive check (ended_at is null or ended_at > started_at)
);

-- This composite identity is the concurrency-safe parent/child authority. The
-- foreign key's PostgreSQL RI locks serialize a segment insert against a
-- concurrent parent tenant/owner update in either statement order.
alter table public.time_logs
  add constraint time_logs_segment_parent_key
  unique (id, organization_id, user_id);

alter table public.time_log_segments
  add constraint time_log_segments_parent_identity_fkey
  foreign key (time_log_id, organization_id, user_id)
  references public.time_logs (id, organization_id, user_id)
  on delete cascade;

create unique index if not exists one_open_time_segment_per_user
  on public.time_log_segments (organization_id, user_id)
  where ended_at is null;

create index if not exists time_log_segments_attempt_idx
  on public.time_log_segments (time_log_id, started_at);

create index if not exists time_log_segments_owner_idx
  on public.time_log_segments (organization_id, user_id, started_at);

alter table public.time_log_segments enable row level security;

create policy "Org members can view time log segments"
  on public.time_log_segments for select
  using (organization_id in (select get_user_org_ids()));

create policy "Users can insert their own time log segments"
  on public.time_log_segments for insert
  with check (
    user_id = auth.uid()
    and organization_id in (select get_user_org_ids())
  );

create policy "Users can update their own time log segments"
  on public.time_log_segments for update
  using (
    user_id = auth.uid()
    and organization_id in (select get_user_org_ids())
  )
  with check (
    user_id = auth.uid()
    and organization_id in (select get_user_org_ids())
  );

create policy "Users can delete their own time log segments"
  on public.time_log_segments for delete
  using (
    user_id = auth.uid()
    and organization_id in (select get_user_org_ids())
  );

create or replace function public.enforce_time_log_segment_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_organization_id uuid;
  parent_user_id uuid;
begin
  select time_logs.organization_id, time_logs.user_id
    into parent_organization_id, parent_user_id
    from public.time_logs
    where time_logs.id = new.time_log_id;

  if not found then
    raise exception 'time log segment parent does not exist'
      using errcode = '23503';
  end if;

  if new.organization_id is distinct from parent_organization_id
     or new.user_id is distinct from parent_user_id then
    raise exception 'time log segment tenant or owner differs from parent log'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_time_log_segment_parent() from public, anon, authenticated;

create trigger enforce_time_log_segment_parent
  before insert or update of time_log_id, organization_id, user_id
  on public.time_log_segments
  for each row execute function public.enforce_time_log_segment_parent();

create or replace function public.protect_segmented_time_log_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.organization_id is distinct from old.organization_id
    or new.user_id is distinct from old.user_id
  ) and exists (
    select 1
    from public.time_log_segments
    where time_log_segments.time_log_id = old.id
  ) then
    raise exception 'segmented time log tenant and owner are immutable'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_segmented_time_log_parent() from public, anon, authenticated;

create trigger protect_segmented_time_log_parent
  before update of organization_id, user_id
  on public.time_logs
  for each row execute function public.protect_segmented_time_log_parent();

-- Only a legacy row that was actively running has a trustworthy segment start.
-- row_number handles invalid legacy duplicates conservatively while the partial
-- unique index preserves the one-running-timer invariant.
with legacy_running as (
  select
    time_logs.id,
    time_logs.organization_id,
    time_logs.user_id,
    time_logs.timer_started_at,
    row_number() over (
      partition by time_logs.organization_id, time_logs.user_id
      order by time_logs.timer_started_at desc, time_logs.id
    ) as owner_rank
  from public.time_logs
  where time_logs.status = 'in_progress'
    and time_logs.timer_started_at is not null
    and time_logs.user_id is not null
    and not exists (
      select 1
      from public.time_log_segments
      where time_log_segments.time_log_id = time_logs.id
    )
)
insert into public.time_log_segments (
  time_log_id,
  organization_id,
  user_id,
  started_at
)
select
  legacy_running.id,
  legacy_running.organization_id,
  legacy_running.user_id,
  legacy_running.timer_started_at
from legacy_running
where legacy_running.owner_rank = 1
on conflict do nothing;

create or replace function public.start_task_timer(
  p_task_id uuid,
  p_started_at timestamptz
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  owned_task public.tasks%rowtype;
  trusted_project public.projects%rowtype;
  trusted_client_id uuid;
  attempt public.time_logs%rowtype;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_started_at is null then
    raise exception 'timer start timestamp is required' using errcode = '22004';
  end if;

  select tasks.*
    into owned_task
    from public.tasks
    where tasks.id = p_task_id
    for update;

  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.organization_members
    where organization_members.organization_id = owned_task.organization_id
      and organization_members.user_id = actor_id
  ) then
    raise exception 'task is outside the authenticated organization'
      using errcode = '42501';
  end if;

  -- Assignment is the task-level ownership boundary. A row lock makes claiming
  -- an entirely unassigned task atomic; otherwise the actor must already be one
  -- of its legacy or multi-assignees.
  if owned_task.assignee_id is null
     and cardinality(owned_task.assignee_ids) = 0 then
    update public.tasks
      set assignee_id = actor_id,
          assignee_ids = array[actor_id]
      where tasks.id = owned_task.id
      returning * into owned_task;
  elsif not (
    owned_task.assignee_id = actor_id
    or actor_id = any(owned_task.assignee_ids)
  ) then
    raise exception 'task is assigned to another user'
      using errcode = '42501';
  end if;

  -- tasks.project_id is nullable (migration 014): tasks are created from the
  -- client page with no project. Only validate a project the task actually has,
  -- matching how finalize_time_attempt resolves its trusted client.
  if owned_task.project_id is not null then
    select projects.*
      into trusted_project
      from public.projects
      where projects.id = owned_task.project_id
        and projects.organization_id = owned_task.organization_id;

    if not found then
      raise exception 'task project is outside the task organization'
        using errcode = '23514';
    end if;
    if owned_task.client_id is not null
       and owned_task.client_id is distinct from trusted_project.client_id then
      raise exception 'task client differs from its project client'
        using errcode = '23514';
    end if;

    trusted_client_id := coalesce(owned_task.client_id, trusted_project.client_id);
  else
    trusted_client_id := owned_task.client_id;
  end if;
  if trusted_client_id is not null and not exists (
    select 1
    from public.clients
    where clients.id = trusted_client_id
      and clients.organization_id = owned_task.organization_id
  ) then
    raise exception 'task client is outside the task organization'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(owned_task.organization_id::text || ':' || actor_id::text, 0)
  );

  insert into public.time_logs (
    organization_id,
    client_id,
    project_id,
    task_id,
    user_id,
    date,
    hours,
    description,
    billable,
    counts_toward_budget,
    status,
    timer_started_at,
    elapsed_seconds,
    category,
    planned_starts_at,
    planned_minutes
  ) values (
    owned_task.organization_id,
    trusted_client_id,
    trusted_project.id,
    owned_task.id,
    actor_id,
    (p_started_at at time zone 'UTC')::date,
    0,
    owned_task.title,
    true,
    trusted_client_id is not null,
    'in_progress',
    p_started_at,
    0,
    owned_task.category,
    owned_task.start_date,
    owned_task.scheduled_minutes
  )
  returning * into attempt;

  update public.tasks
    set start_date = null,
        scheduled_minutes = null
    where tasks.id = owned_task.id;

  insert into public.time_log_segments (
    time_log_id,
    organization_id,
    user_id,
    started_at
  ) values (
    attempt.id,
    attempt.organization_id,
    actor_id,
    p_started_at
  );

  return next attempt;
end;
$$;

revoke execute on function public.start_task_timer(uuid, timestamptz) from public, anon;
grant execute on function public.start_task_timer(uuid, timestamptz) to authenticated;

create or replace function public.pause_time_attempt(
  p_time_log_id uuid,
  p_paused_at timestamptz
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  attempt public.time_logs%rowtype;
  open_segment public.time_log_segments%rowtype;
  latest_ended_at timestamptz;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_paused_at is null then
    raise exception 'pause timestamp is required' using errcode = '22004';
  end if;

  select time_logs.*
    into attempt
    from public.time_logs
    where time_logs.id = p_time_log_id
      and time_logs.user_id = actor_id
      and time_logs.status = 'in_progress'
      and exists (
        select 1
        from public.organization_members
        where organization_members.organization_id = time_logs.organization_id
          and organization_members.user_id = actor_id
      )
    for update;

  if not found then
    raise exception 'owned in-progress time attempt not found'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(attempt.organization_id::text || ':' || actor_id::text, 0)
  );

  select time_log_segments.*
    into open_segment
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id
      and time_log_segments.ended_at is null
    for update;

  if not found then
    select max(time_log_segments.ended_at)
      into latest_ended_at
      from public.time_log_segments
      where time_log_segments.time_log_id = attempt.id;

    if attempt.reviewing_at is null
       and attempt.timer_started_at is null
       and latest_ended_at is not null
       and latest_ended_at is not distinct from p_paused_at then
      return next attempt;
      return;
    end if;

    raise exception 'time attempt is not running or pause retry conflicts'
      using errcode = '55000';
  end if;
  if p_paused_at <= open_segment.started_at then
    raise exception 'pause timestamp must be after segment start'
      using errcode = '22007';
  end if;

  update public.time_log_segments
    set ended_at = p_paused_at
    where time_log_segments.id = open_segment.id;

  update public.time_logs
    set timer_started_at = null
    where time_logs.id = attempt.id
    returning * into attempt;

  return next attempt;
end;
$$;

revoke execute on function public.pause_time_attempt(uuid, timestamptz) from public, anon;
grant execute on function public.pause_time_attempt(uuid, timestamptz) to authenticated;

create or replace function public.resume_time_attempt(
  p_time_log_id uuid,
  p_resumed_at timestamptz
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  attempt public.time_logs%rowtype;
  latest_ended_at timestamptz;
  open_segment public.time_log_segments%rowtype;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_resumed_at is null then
    raise exception 'resume timestamp is required' using errcode = '22004';
  end if;

  select time_logs.*
    into attempt
    from public.time_logs
    where time_logs.id = p_time_log_id
      and time_logs.user_id = actor_id
      and time_logs.status = 'in_progress'
      and exists (
        select 1
        from public.organization_members
        where organization_members.organization_id = time_logs.organization_id
          and organization_members.user_id = actor_id
      )
    for update;

  if not found then
    raise exception 'owned in-progress time attempt not found'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(attempt.organization_id::text || ':' || actor_id::text, 0)
  );

  select time_log_segments.*
    into open_segment
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id
      and time_log_segments.ended_at is null
    for update;

  if found then
    if open_segment.started_at is not distinct from p_resumed_at
       and attempt.timer_started_at is not distinct from p_resumed_at
       and attempt.reviewing_at is null
       and not exists (
         select 1
         from public.time_log_segments
         where time_log_segments.time_log_id = attempt.id
           and time_log_segments.ended_at > p_resumed_at
       ) then
      return next attempt;
      return;
    end if;

    raise exception 'time attempt is already running with conflicting state'
      using errcode = '55000';
  end if;

  select max(time_log_segments.ended_at)
    into latest_ended_at
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id;

  if latest_ended_at is not null and p_resumed_at < latest_ended_at then
    raise exception 'resume timestamp precedes the latest segment end'
      using errcode = '22007';
  end if;

  insert into public.time_log_segments (
    time_log_id,
    organization_id,
    user_id,
    started_at
  ) values (
    attempt.id,
    attempt.organization_id,
    actor_id,
    p_resumed_at
  );

  update public.time_logs
    set timer_started_at = p_resumed_at,
        reviewing_at = null
    where time_logs.id = attempt.id
    returning * into attempt;

  return next attempt;
end;
$$;

revoke execute on function public.resume_time_attempt(uuid, timestamptz) from public, anon;
grant execute on function public.resume_time_attempt(uuid, timestamptz) to authenticated;

create or replace function public.switch_time_attempt(
  p_from_time_log_id uuid,
  p_to_time_log_id uuid,
  p_to_task_id uuid,
  p_switched_at timestamptz
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  paused_attempt public.time_logs%rowtype;
  active_attempt public.time_logs%rowtype;
  target_task public.tasks%rowtype;
  target_segment public.time_log_segments%rowtype;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_switched_at is null then
    raise exception 'switch timestamp is required' using errcode = '22004';
  end if;
  if (p_to_time_log_id is null) = (p_to_task_id is null) then
    raise exception 'switch requires exactly one target attempt or target task'
      using errcode = '22023';
  end if;
  if p_to_time_log_id is not null and p_to_time_log_id = p_from_time_log_id then
    raise exception 'switch target must differ from running attempt'
      using errcode = '22023';
  end if;

  select paused.*
    into paused_attempt
    from public.pause_time_attempt(p_from_time_log_id, p_switched_at) as paused
    limit 1;

  if p_to_time_log_id is not null then
    select resumed.*
      into active_attempt
      from public.resume_time_attempt(p_to_time_log_id, p_switched_at) as resumed
      limit 1;
  else
    select time_logs.*
      into active_attempt
      from public.time_logs
      where time_logs.task_id = p_to_task_id
        and time_logs.user_id = actor_id
        and exists (
          select 1
          from public.time_log_segments
          where time_log_segments.time_log_id = time_logs.id
            and time_log_segments.started_at = p_switched_at
        )
      order by time_logs.created_at desc, time_logs.id
      limit 1
      for update of time_logs;

    if found then
      perform pg_advisory_xact_lock(
        hashtextextended(active_attempt.organization_id::text || ':' || actor_id::text, 0)
      );

      perform 1
        from public.organization_members
        where organization_members.organization_id = active_attempt.organization_id
          and organization_members.user_id = actor_id
        for key share;

      if not found then
        raise exception 'actor is no longer a member of the switch target organization'
          using errcode = '42501';
      end if;

      select tasks.*
        into target_task
        from public.tasks
        where tasks.id = p_to_task_id
          and tasks.organization_id = active_attempt.organization_id
        for share;

      if not found or not (
        target_task.assignee_id = actor_id
        or actor_id = any(target_task.assignee_ids)
      ) then
        raise exception 'actor no longer owns the switch target task'
          using errcode = '42501';
      end if;

      select time_log_segments.*
        into target_segment
        from public.time_log_segments
        where time_log_segments.time_log_id = active_attempt.id
          and time_log_segments.started_at = p_switched_at
        order by time_log_segments.id
        limit 1
        for update;

      if not found then
        raise exception 'switch retry target segment no longer exists'
          using errcode = '55000';
      end if;

      if active_attempt.status = 'in_progress'
         and active_attempt.reviewing_at is null
         and active_attempt.timer_started_at is not distinct from p_switched_at
         and target_segment.ended_at is null
         and not exists (
           select 1
           from public.time_log_segments
           where time_log_segments.time_log_id = active_attempt.id
             and time_log_segments.ended_at > p_switched_at
         ) then
        null; -- Exact switch retry: return the already-active canonical row.
      else
        raise exception 'switch retry conflicts with advanced target state'
          using errcode = '55000';
      end if;
    else
      select started.*
        into active_attempt
        from public.start_task_timer(p_to_task_id, p_switched_at) as started
        limit 1;
    end if;
  end if;

  return next paused_attempt;
  return next active_attempt;
end;
$$;

revoke execute on function public.switch_time_attempt(uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.switch_time_attempt(uuid, uuid, uuid, timestamptz) to authenticated;

create or replace function public.begin_stop_review(
  p_time_log_id uuid,
  p_reviewing_at timestamptz
)
returns setof public.time_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  attempt public.time_logs%rowtype;
  open_segment public.time_log_segments%rowtype;
  latest_ended_at timestamptz;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_reviewing_at is null then
    raise exception 'review timestamp is required' using errcode = '22004';
  end if;

  select time_logs.*
    into attempt
    from public.time_logs
    where time_logs.id = p_time_log_id
      and time_logs.user_id = actor_id
      and time_logs.status = 'in_progress'
      and exists (
        select 1
        from public.organization_members
        where organization_members.organization_id = time_logs.organization_id
          and organization_members.user_id = actor_id
      )
    for update;

  if not found then
    raise exception 'owned in-progress time attempt not found'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(attempt.organization_id::text || ':' || actor_id::text, 0)
  );

  select time_log_segments.*
    into open_segment
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id
      and time_log_segments.ended_at is null
    for update;

  if found then
    if p_reviewing_at <= open_segment.started_at then
      raise exception 'review timestamp must be after segment start'
        using errcode = '22007';
    end if;
    update public.time_log_segments
      set ended_at = p_reviewing_at
      where time_log_segments.id = open_segment.id;
  end if;

  select max(time_log_segments.ended_at)
    into latest_ended_at
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id;

  if latest_ended_at is not null and p_reviewing_at < latest_ended_at then
    raise exception 'review timestamp precedes the latest segment end'
      using errcode = '22007';
  end if;

  update public.time_logs
    set timer_started_at = null,
        reviewing_at = p_reviewing_at
    where time_logs.id = attempt.id
    returning * into attempt;

  return next attempt;
end;
$$;

revoke execute on function public.begin_stop_review(uuid, timestamptz) from public, anon;
grant execute on function public.begin_stop_review(uuid, timestamptz) to authenticated;

create or replace function public.finalize_time_attempt(
  p_time_log_id uuid,
  p_description text,
  p_billable boolean,
  p_counts_toward_budget boolean,
  p_time_zone text,
  p_operation_id uuid,
  p_finalized_at timestamptz
)
returns table (
  time_log_id uuid,
  task_id uuid,
  client_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  attempt public.time_logs%rowtype;
  trusted_task public.tasks%rowtype;
  trusted_project public.projects%rowtype;
  trusted_client_id uuid;
  segment public.time_log_segments%rowtype;
  day_entry record;
  cursor_at timestamptz;
  slice_end timestamptz;
  next_midnight timestamptz;
  slice_date date;
  first_date date;
  seconds_by_date jsonb := '{}'::jsonb;
  log_ids_by_date jsonb := '{}'::jsonb;
  daily_log_id uuid;
  first_piece boolean;
  latest_ended_at timestamptz;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_time_zone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names
    where pg_timezone_names.name = p_time_zone
  ) then
    raise exception 'invalid time zone' using errcode = '22023';
  end if;
  if p_operation_id is null or p_finalized_at is null then
    raise exception 'operation and finalization timestamps are required'
      using errcode = '22004';
  end if;
  if p_billable is null or p_counts_toward_budget is null then
    raise exception 'billable and budget decisions are required'
      using errcode = '22004';
  end if;

  select time_logs.*
    into attempt
    from public.time_logs
    where time_logs.id = p_time_log_id
      and time_logs.user_id = actor_id
      and exists (
        select 1
        from public.organization_members
        where organization_members.organization_id = time_logs.organization_id
          and organization_members.user_id = actor_id
      )
    for update;

  if not found then
    raise exception 'owned time attempt not found' using errcode = '42501';
  end if;

  if attempt.project_id is not null then
    select projects.*
      into trusted_project
      from public.projects
      where projects.id = attempt.project_id
        and projects.organization_id = attempt.organization_id
      for share;

    if not found then
      raise exception 'time attempt project is outside its organization'
        using errcode = '23514';
    end if;
    trusted_client_id := trusted_project.client_id;
  else
    trusted_client_id := attempt.client_id;
  end if;

  if attempt.task_id is not null then
    select tasks.*
      into trusted_task
      from public.tasks
      where tasks.id = attempt.task_id
        and tasks.organization_id = attempt.organization_id
      for share;

    if not found or trusted_task.project_id is distinct from attempt.project_id then
      raise exception 'time attempt task is outside its trusted project'
        using errcode = '23514';
    end if;
    if trusted_task.client_id is not null
       and trusted_task.client_id is distinct from trusted_client_id then
      raise exception 'time attempt task client differs from its project client'
        using errcode = '23514';
    end if;
    trusted_client_id := coalesce(trusted_task.client_id, trusted_client_id);
  end if;

  if attempt.client_id is distinct from trusted_client_id then
    raise exception 'time attempt client differs from its trusted task or project'
      using errcode = '23514';
  end if;
  if trusted_client_id is not null and not exists (
    select 1
    from public.clients
    where clients.id = trusted_client_id
      and clients.organization_id = attempt.organization_id
  ) then
    raise exception 'time attempt client is outside its organization'
      using errcode = '23514';
  end if;

  if attempt.status = 'logged' and attempt.operation_id = p_operation_id then
    return query
      select time_logs.id, time_logs.task_id, time_logs.client_id
      from public.time_logs
      where time_logs.operation_id = p_operation_id
        and time_logs.user_id = actor_id
        and time_logs.organization_id = attempt.organization_id
        and time_logs.task_id is not distinct from attempt.task_id
        and time_logs.client_id is not distinct from attempt.client_id
      order by time_logs.date, time_logs.id;
    return;
  end if;

  if attempt.status <> 'in_progress' then
    raise exception 'time attempt is not finalizable' using errcode = '55000';
  end if;
  if attempt.reviewing_at is null or p_finalized_at < attempt.reviewing_at then
    raise exception 'time attempt must enter review before finalization'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id
      and time_log_segments.ended_at is null
  ) then
    raise exception 'time attempt must enter review before finalization'
      using errcode = '55000';
  end if;

  select max(time_log_segments.ended_at)
    into latest_ended_at
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id;

  if latest_ended_at is not null and (
    attempt.reviewing_at < latest_ended_at
    or p_finalized_at < latest_ended_at
  ) then
    raise exception 'review or finalization timestamp precedes tracked work'
      using errcode = '22007';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('timer-operation:' || p_operation_id::text, 0)
  );

  if exists (
    select 1
    from public.time_logs
    where time_logs.operation_id = p_operation_id
      and time_logs.id <> attempt.id
  ) then
    raise exception 'operation identifier is already in use'
      using errcode = '23505';
  end if;

  for segment in
    select time_log_segments.*
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id
    order by time_log_segments.started_at, time_log_segments.id
    for update
  loop
    cursor_at := segment.started_at;
    while cursor_at < segment.ended_at loop
      slice_date := (cursor_at at time zone p_time_zone)::date;
      next_midnight := ((slice_date + 1)::timestamp at time zone p_time_zone);
      slice_end := least(segment.ended_at, next_midnight);
      seconds_by_date := jsonb_set(
        seconds_by_date,
        array[slice_date::text],
        to_jsonb(
          coalesce((seconds_by_date ->> slice_date::text)::numeric, 0)
          + extract(epoch from (slice_end - cursor_at))
        ),
        true
      );
      first_date := least(coalesce(first_date, slice_date), slice_date);
      cursor_at := slice_end;
    end loop;
  end loop;

  -- elapsed_seconds remains the baseline for pre-033 timer history. New segment
  -- duration is added to it without inventing a historical segment.
  if attempt.elapsed_seconds > 0 then
    first_date := least(coalesce(first_date, attempt.date), attempt.date);
    seconds_by_date := jsonb_set(
      seconds_by_date,
      array[attempt.date::text],
      to_jsonb(
        coalesce((seconds_by_date ->> attempt.date::text)::numeric, 0)
        + attempt.elapsed_seconds
      ),
      true
    );
  end if;

  if first_date is null then
    raise exception 'time attempt has no tracked duration' using errcode = '22000';
  end if;

  update public.time_logs
    set date = first_date,
        hours = round(((seconds_by_date ->> first_date::text)::numeric / 3600), 2),
        description = p_description,
        billable = p_billable,
        counts_toward_budget = p_counts_toward_budget,
        status = 'logged',
        timer_started_at = null,
        elapsed_seconds = round((seconds_by_date ->> first_date::text)::numeric)::integer,
        reviewing_at = null,
        operation_id = p_operation_id
    where time_logs.id = attempt.id;

  log_ids_by_date := jsonb_build_object(first_date::text, attempt.id::text);

  for day_entry in
    select daily.key as local_date, daily.value as active_seconds
    from jsonb_each_text(seconds_by_date) as daily
    where daily.key <> first_date::text
    order by daily.key
  loop
    insert into public.time_logs (
      organization_id,
      client_id,
      project_id,
      task_id,
      user_id,
      date,
      hours,
      description,
      billable,
      counts_toward_budget,
      status,
      timer_started_at,
      elapsed_seconds,
      category,
      session_notes,
      basecamp_project_id,
      planned_starts_at,
      planned_minutes,
      reviewing_at,
      operation_id,
      created_at
    ) values (
      attempt.organization_id,
      attempt.client_id,
      attempt.project_id,
      attempt.task_id,
      actor_id,
      day_entry.local_date::date,
      round((day_entry.active_seconds::numeric / 3600), 2),
      p_description,
      p_billable,
      p_counts_toward_budget,
      'logged',
      null,
      round(day_entry.active_seconds::numeric)::integer,
      attempt.category,
      attempt.session_notes,
      attempt.basecamp_project_id,
      attempt.planned_starts_at,
      attempt.planned_minutes,
      null,
      p_operation_id,
      p_finalized_at
    )
    returning id into daily_log_id;

    log_ids_by_date := jsonb_set(
      log_ids_by_date,
      array[day_entry.local_date],
      to_jsonb(daily_log_id::text),
      true
    );
  end loop;

  -- Re-parent every segment to its daily log and physically split a segment at
  -- each local-midnight boundary. The first piece retains the original ID.
  for segment in
    select time_log_segments.*
    from public.time_log_segments
    where time_log_segments.time_log_id = attempt.id
    order by time_log_segments.started_at, time_log_segments.id
  loop
    cursor_at := segment.started_at;
    first_piece := true;
    while cursor_at < segment.ended_at loop
      slice_date := (cursor_at at time zone p_time_zone)::date;
      next_midnight := ((slice_date + 1)::timestamp at time zone p_time_zone);
      slice_end := least(segment.ended_at, next_midnight);
      daily_log_id := (log_ids_by_date ->> slice_date::text)::uuid;

      if first_piece then
        update public.time_log_segments
          set time_log_id = daily_log_id,
              started_at = cursor_at,
              ended_at = slice_end
          where time_log_segments.id = segment.id;
        first_piece := false;
      else
        insert into public.time_log_segments (
          time_log_id,
          organization_id,
          user_id,
          started_at,
          ended_at,
          created_at
        ) values (
          daily_log_id,
          segment.organization_id,
          segment.user_id,
          cursor_at,
          slice_end,
          segment.created_at
        );
      end if;

      cursor_at := slice_end;
    end loop;
  end loop;

  return query
    select time_logs.id, time_logs.task_id, time_logs.client_id
    from public.time_logs
    where time_logs.id in (
      select mapping.value::uuid
      from jsonb_each_text(log_ids_by_date) as mapping
    )
    order by time_logs.date, time_logs.id;
end;
$$;

revoke execute on function public.finalize_time_attempt(uuid, text, boolean, boolean, text, uuid, timestamptz) from public, anon;
grant execute on function public.finalize_time_attempt(uuid, text, boolean, boolean, text, uuid, timestamptz) to authenticated;

-- Migration 035: atomic jsonb merge for clients.custom_fields
create or replace function public.merge_client_custom_fields(
  p_client_id uuid,
  p_organization_id uuid,
  p_patch jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch must be a jsonb object' using errcode = '22004';
  end if;

  update public.clients
     set custom_fields = coalesce(custom_fields, '{}'::jsonb) || p_patch
   where id = p_client_id
     and organization_id = p_organization_id;
end;
$$;

revoke all on function public.merge_client_custom_fields(uuid, uuid, jsonb) from public;
grant execute on function public.merge_client_custom_fields(uuid, uuid, jsonb) to service_role;

-- Migration 036: idempotent planner-time logging when a task is completed
alter table public.time_logs
  add column if not exists completion_operation_id uuid;

create unique index if not exists time_logs_completion_operation_unique
  on public.time_logs (completion_operation_id)
  where completion_operation_id is not null;

create or replace function public.log_task_completion_time(
  p_task_id uuid,
  p_minutes integer,
  p_operation_id uuid,
  p_time_zone text,
  p_logged_at timestamptz
)
returns table (time_log_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  owned_task public.tasks%rowtype;
  existing_log_id uuid;
  new_log_id uuid;
  segment_start timestamptz;
  segment_end timestamptz;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_task_id is null or p_operation_id is null or p_logged_at is null then
    raise exception 'task, operation, and log timestamp are required'
      using errcode = '22004';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 1440 then
    raise exception 'completion time must be between 1 and 1440 minutes'
      using errcode = '22023';
  end if;
  if p_time_zone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names
    where pg_timezone_names.name = p_time_zone
  ) then
    raise exception 'invalid time zone' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('task-completion-time:' || p_operation_id::text, 0)
  );

  select time_logs.id
    into existing_log_id
    from public.time_logs
    where time_logs.completion_operation_id = p_operation_id
      and time_logs.user_id = actor_id;

  if found then
    return query select existing_log_id;
    return;
  end if;

  select tasks.*
    into owned_task
    from public.tasks
    where tasks.id = p_task_id
    for share;

  if not found or not exists (
    select 1
    from public.organization_members
    where organization_members.organization_id = owned_task.organization_id
      and organization_members.user_id = actor_id
  ) then
    raise exception 'task is outside the authenticated organization'
      using errcode = '42501';
  end if;

  if owned_task.status = 'done' then
    raise exception 'task is already complete' using errcode = '55000';
  end if;

  segment_start := coalesce(
    owned_task.start_date,
    p_logged_at - make_interval(mins => p_minutes)
  );
  segment_end := segment_start + make_interval(mins => p_minutes);

  insert into public.time_logs (
    organization_id,
    client_id,
    project_id,
    task_id,
    user_id,
    date,
    hours,
    description,
    billable,
    counts_toward_budget,
    status,
    timer_started_at,
    elapsed_seconds,
    category,
    planned_starts_at,
    planned_minutes,
    completion_operation_id,
    created_at
  ) values (
    owned_task.organization_id,
    owned_task.client_id,
    owned_task.project_id,
    owned_task.id,
    actor_id,
    (segment_start at time zone p_time_zone)::date,
    round((p_minutes::numeric / 60), 2),
    owned_task.title,
    owned_task.client_id is not null,
    owned_task.client_id is not null,
    'logged',
    null,
    p_minutes * 60,
    owned_task.category,
    owned_task.start_date,
    owned_task.scheduled_minutes,
    p_operation_id,
    p_logged_at
  )
  returning id into new_log_id;

  insert into public.time_log_segments (
    time_log_id,
    organization_id,
    user_id,
    started_at,
    ended_at
  ) values (
    new_log_id,
    owned_task.organization_id,
    actor_id,
    segment_start,
    segment_end
  );

  return query select new_log_id;
end;
$$;

revoke execute on function public.log_task_completion_time(uuid, integer, uuid, text, timestamptz)
  from public, anon;
grant execute on function public.log_task_completion_time(uuid, integer, uuid, text, timestamptz)
  to authenticated;

-- Migration 037: durable, service-only Basecamp webhook delivery receipts
create table if not exists public.basecamp_webhook_deliveries (
  event_id bigint primary key,
  request_id uuid not null unique,
  kind text not null,
  recording_id bigint not null,
  received_at timestamp with time zone
    default timezone('utc'::text, now()) not null,
  processed_at timestamp with time zone,
  result text
);

alter table public.basecamp_webhook_deliveries enable row level security;

revoke all on table public.basecamp_webhook_deliveries
  from public, anon, authenticated;
grant select, insert, update on table public.basecamp_webhook_deliveries
  to service_role;

-- Migration 038: timesheet ledger provenance + immutable client-month approvals
-- Ledger provenance on time_logs
-- ---------------------------------------------------------------------------

alter table public.time_logs
  add column if not exists source text not null default 'seo_pm';

alter table public.time_logs
  drop constraint if exists time_logs_source_check;
alter table public.time_logs
  add constraint time_logs_source_check
  check (source in ('seo_pm', 'basecamp'));

alter table public.time_logs
  add column if not exists import_status text not null default 'mapped';

alter table public.time_logs
  drop constraint if exists time_logs_import_status_check;
alter table public.time_logs
  add constraint time_logs_import_status_check
  check (import_status in ('mapped', 'needs_review', 'voided'));

alter table public.time_logs
  add column if not exists imported_at timestamp with time zone;
alter table public.time_logs
  add column if not exists provider_updated_at timestamp with time zone;
alter table public.time_logs
  add column if not exists voided_at timestamp with time zone;

-- Who resolved an unmapped import to a client/task/member, and when.
alter table public.time_logs
  add column if not exists mapped_by uuid references public.users(id) on delete set null;
alter table public.time_logs
  add column if not exists mapped_at timestamp with time zone;

-- Hard deduplication invariant: one ledger row per Basecamp entry, ever.
-- Webhook retries, reconciliation runs, and SEO PM -> Basecamp echoes all
-- collapse onto the same row instead of creating a second one.
create unique index if not exists time_logs_basecamp_entry_unique
  on public.time_logs (basecamp_entry_id)
  where basecamp_entry_id is not null;

create index if not exists time_logs_import_review_idx
  on public.time_logs (organization_id, import_status)
  where import_status <> 'mapped';

create index if not exists time_logs_ledger_week_idx
  on public.time_logs (organization_id, user_id, date);

-- ---------------------------------------------------------------------------
-- Provider provenance is server-controlled (supersedes nothing in 032; adds to it)
-- ---------------------------------------------------------------------------

create or replace function public.protect_time_log_import_provenance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT'
     and (
       new.source is distinct from 'seo_pm'
       or new.import_status is distinct from 'mapped'
       or new.imported_at is not null
       or new.provider_updated_at is not null
       or new.voided_at is not null
     ) then
    raise exception 'time log import provenance is server-controlled'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and (
       new.source is distinct from old.source
       or new.import_status is distinct from old.import_status
       or new.imported_at is distinct from old.imported_at
       or new.provider_updated_at is distinct from old.provider_updated_at
       or new.voided_at is distinct from old.voided_at
     ) then
    raise exception 'time log import provenance is server-controlled'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_time_log_import_provenance on public.time_logs;
create trigger protect_time_log_import_provenance
  before insert or update of source, import_status, imported_at, provider_updated_at, voided_at
  on public.time_logs
  for each row execute function public.protect_time_log_import_provenance();

-- ---------------------------------------------------------------------------
-- Client-month approval snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.timesheet_client_approvals (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  month text not null,
  status text not null default 'approved' check (status in ('approved', 'reopened')),
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamp with time zone default timezone('utc'::text, now()) not null,
  reopened_by uuid references public.users(id) on delete set null,
  reopened_at timestamp with time zone,
  note text,
  budget_minutes integer not null default 0,
  eligible_minutes integer not null default 0,
  non_budget_minutes integer not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.timesheet_client_approvals
  drop constraint if exists timesheet_client_approvals_month_format;
alter table public.timesheet_client_approvals
  add constraint timesheet_client_approvals_month_format
  check (month ~ '^[0-9]{4}-[0-9]{2}$');

-- At most one live approval per client month; reopened rows stay as history.
create unique index if not exists timesheet_client_approvals_active_unique
  on public.timesheet_client_approvals (client_id, month)
  where status = 'approved';

create index if not exists timesheet_client_approvals_org_month_idx
  on public.timesheet_client_approvals (organization_id, month);

create table if not exists public.timesheet_approval_entries (
  id uuid default uuid_generate_v4() primary key,
  approval_id uuid references public.timesheet_client_approvals(id) on delete cascade not null,
  time_log_id uuid references public.time_logs(id) on delete cascade not null,
  included_minutes integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (approval_id, time_log_id)
);

create index if not exists timesheet_approval_entries_time_log_idx
  on public.timesheet_approval_entries (time_log_id);

alter table public.timesheet_client_approvals enable row level security;
alter table public.timesheet_approval_entries enable row level security;

-- Org members may read approvals; every write goes through a server route.
create policy "Org members can read timesheet approvals"
  on public.timesheet_client_approvals for select
  using ( organization_id in (select get_user_org_ids()) );

create policy "Org members can read timesheet approval entries"
  on public.timesheet_approval_entries for select
  using (
    approval_id in (
      select id from public.timesheet_client_approvals
      where organization_id in (select get_user_org_ids())
    )
  );

revoke all on table public.timesheet_client_approvals from public, anon;
revoke all on table public.timesheet_approval_entries from public, anon;
grant select on table public.timesheet_client_approvals to authenticated;
grant select on table public.timesheet_approval_entries to authenticated;
grant select, insert, update, delete on table public.timesheet_client_approvals
  to service_role;
grant select, insert, update, delete on table public.timesheet_approval_entries
  to service_role;

-- Migration 040: import context capture + review workflow
-- Review state machine
-- ---------------------------------------------------------------------------

-- Widen the constraint FIRST. Migration 038 allows only
-- ('mapped', 'needs_review', 'voided'), so writing 'needs_context' while that
-- check is still in force raises 23514 on the first matching row and rolls the
-- entire migration back. Widen, then migrate the existing rows.
alter table public.time_logs
  drop constraint if exists time_logs_import_status_check;
alter table public.time_logs
  add constraint time_logs_import_status_check
  check (import_status in ('needs_context', 'pending_review', 'mapped', 'voided'));

-- Existing rows carry the old spelling; move them onto the new value.
update public.time_logs
   set import_status = 'needs_context'
 where import_status = 'needs_review';

alter table public.time_logs
  add column if not exists activity_key text;
alter table public.time_logs
  add column if not exists import_fingerprint text;
alter table public.time_logs
  add column if not exists submitted_at timestamp with time zone;
alter table public.time_logs
  add column if not exists submitted_by uuid references public.users(id) on delete set null;
alter table public.time_logs
  add column if not exists reviewed_at timestamp with time zone;
alter table public.time_logs
  add column if not exists reviewed_by uuid references public.users(id) on delete set null;
alter table public.time_logs
  add column if not exists review_note text;

-- CSV identity. Same role as time_logs_basecamp_entry_unique, for rows whose
-- provider id is not knowable at import time.
create unique index if not exists time_logs_import_fingerprint_unique
  on public.time_logs (import_fingerprint)
  where import_fingerprint is not null;

create index if not exists time_logs_import_queue_idx
  on public.time_logs (organization_id, user_id, import_status)
  where import_status in ('needs_context', 'pending_review');

-- Fingerprint is provider-derived, so it joins the service-only column set.
drop trigger if exists protect_time_log_import_provenance on public.time_logs;
create trigger protect_time_log_import_provenance
  before insert or update of source, import_status, imported_at, provider_updated_at, voided_at, import_fingerprint
  on public.time_logs
  for each row execute function public.protect_time_log_import_provenance();

-- ---------------------------------------------------------------------------
-- Project roles — the import gate
-- ---------------------------------------------------------------------------

create table if not exists public.basecamp_project_roles (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  basecamp_project_id bigint not null,
  basecamp_project_name text,
  role text not null check (role in ('client', 'internal', 'ignored')),
  client_id uuid references public.clients(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint basecamp_project_roles_client_required
    check (role <> 'client' or client_id is not null)
);

create unique index if not exists basecamp_project_roles_unique
  on public.basecamp_project_roles (organization_id, basecamp_project_id);

-- CSV rows name their project rather than identifying it, so name lookup is a
-- first-class access path, not a convenience.
create index if not exists basecamp_project_roles_name_idx
  on public.basecamp_project_roles (organization_id, lower(basecamp_project_name));

alter table public.basecamp_project_roles enable row level security;

create policy "Org members can read basecamp project roles"
  on public.basecamp_project_roles for select
  using ( organization_id in (select get_user_org_ids()) );

revoke all on table public.basecamp_project_roles from public, anon;
grant select on table public.basecamp_project_roles to authenticated;
grant select, insert, update, delete on table public.basecamp_project_roles
  to service_role;

-- ---------------------------------------------------------------------------
-- Import run receipts
-- ---------------------------------------------------------------------------

create table if not exists public.timesheet_import_runs (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  requested_by uuid references public.users(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  range_start date not null,
  range_end date not null,
  source text not null check (source in ('csv', 'upload', 'webhook')),
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  scanned integer not null default 0,
  imported integer not null default 0,
  skipped integer not null default 0,
  error text,
  started_at timestamp with time zone default timezone('utc'::text, now()) not null,
  finished_at timestamp with time zone
);

create index if not exists timesheet_import_runs_org_idx
  on public.timesheet_import_runs (organization_id, started_at desc);

alter table public.timesheet_import_runs enable row level security;

create policy "Org members can read timesheet import runs"
  on public.timesheet_import_runs for select
  using ( organization_id in (select get_user_org_ids()) );

revoke all on table public.timesheet_import_runs from public, anon;
grant select on table public.timesheet_import_runs to authenticated;
grant select, insert, update, delete on table public.timesheet_import_runs
  to service_role;

-- Migration 041: atomic and tenant-safe import review mutations
--
-- Migration 040 may already be applied. This additive RPC closes the
-- validation-to-write race without rewriting that migration.

create or replace function public.apply_timesheet_import_transition(
  p_organization_id uuid,
  p_ids uuid[],
  p_authorized_user_id uuid,
  p_expected_status text,
  p_updates jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target_count integer;
  v_changed_count integer;
  v_client_id uuid;
begin
  if p_organization_id is null
     or p_ids is null
     or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null
     or cardinality(p_ids) <> (
       select count(distinct requested_id)
       from unnest(p_ids) as requested(requested_id)
     ) then
    raise exception 'invalid timesheet import transition target'
      using errcode = '22023';
  end if;

  if p_expected_status not in ('needs_context', 'pending_review') then
    raise exception 'invalid timesheet import transition status'
      using errcode = '22023';
  end if;

  if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
    raise exception 'invalid timesheet import transition patch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_updates) as patch_key(key)
    where patch_key.key not in (
      'activity_key',
      'description',
      'counts_toward_budget',
      'client_id',
      'import_status',
      'submitted_at',
      'submitted_by',
      'reviewed_at',
      'reviewed_by',
      'review_note'
    )
  ) then
    raise exception 'invalid timesheet import transition patch'
      using errcode = '22023';
  end if;

  if p_updates ? 'import_status'
     and coalesce(p_updates ->> 'import_status', '') not in (
       'needs_context',
       'pending_review',
       'mapped',
       'voided'
     ) then
    raise exception 'invalid timesheet import transition status'
      using errcode = '22023';
  end if;

  if p_updates ? 'client_id'
     and jsonb_typeof(p_updates -> 'client_id') <> 'null' then
    begin
      v_client_id := (p_updates ->> 'client_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'invalid timesheet import transition client'
          using errcode = '22023';
    end;

    perform clients.id
    from public.clients
    where clients.id = v_client_id
      and clients.organization_id = p_organization_id
    for key share;

    if not found then
      raise exception 'timesheet_import_transition_conflict'
        using errcode = 'P0001';
    end if;
  end if;

  -- Lock the complete authorized target set before deciding whether to write.
  select count(*)
    into v_target_count
    from (
      select time_logs.id
      from public.time_logs
      where time_logs.organization_id = p_organization_id
        and time_logs.id = any(p_ids)
        and time_logs.import_status = p_expected_status
        and (
          p_authorized_user_id is null
          or time_logs.user_id = p_authorized_user_id
        )
      for update
    ) as locked_targets;

  if v_target_count <> cardinality(p_ids) then
    raise exception 'timesheet_import_transition_conflict'
      using errcode = 'P0001';
  end if;

  update public.time_logs as target
     set activity_key = case
           when p_updates ? 'activity_key' then p_updates ->> 'activity_key'
           else target.activity_key
         end,
         description = case
           when p_updates ? 'description' then p_updates ->> 'description'
           else target.description
         end,
         counts_toward_budget = case
           when exists (
             select 1
             from public.basecamp_project_roles
             where basecamp_project_roles.organization_id = target.organization_id
               and basecamp_project_roles.basecamp_project_id = target.basecamp_project_id
               and basecamp_project_roles.role = 'internal'
           ) then false
           when p_updates ? 'counts_toward_budget'
             then (p_updates ->> 'counts_toward_budget')::boolean
           else target.counts_toward_budget
         end,
         client_id = case
           when exists (
             select 1
             from public.basecamp_project_roles
             where basecamp_project_roles.organization_id = target.organization_id
               and basecamp_project_roles.basecamp_project_id = target.basecamp_project_id
               and basecamp_project_roles.role = 'internal'
           ) then null
           when p_updates ? 'client_id' then v_client_id
           else target.client_id
         end,
         import_status = case
           when p_updates ? 'import_status' then p_updates ->> 'import_status'
           else target.import_status
         end,
         submitted_at = case
           when p_updates ? 'submitted_at' then (p_updates ->> 'submitted_at')::timestamptz
           else target.submitted_at
         end,
         submitted_by = case
           when p_updates ? 'submitted_by' then (p_updates ->> 'submitted_by')::uuid
           else target.submitted_by
         end,
         reviewed_at = case
           when p_updates ? 'reviewed_at' then (p_updates ->> 'reviewed_at')::timestamptz
           else target.reviewed_at
         end,
         reviewed_by = case
           when p_updates ? 'reviewed_by' then (p_updates ->> 'reviewed_by')::uuid
           else target.reviewed_by
         end,
         review_note = case
           when p_updates ? 'review_note' then p_updates ->> 'review_note'
           else target.review_note
         end
   where target.organization_id = p_organization_id
     and target.id = any(p_ids)
     and target.import_status = p_expected_status
     and (
       p_authorized_user_id is null
       or target.user_id = p_authorized_user_id
     );

  get diagnostics v_changed_count = row_count;
  if v_changed_count <> cardinality(p_ids) then
    -- Raising rolls this function call back, including any rows just updated.
    raise exception 'timesheet_import_transition_conflict'
      using errcode = 'P0001';
  end if;

  return v_changed_count;
end;
$$;

revoke execute on function public.apply_timesheet_import_transition(uuid, uuid[], uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_timesheet_import_transition(uuid, uuid[], uuid, text, jsonb)
  to service_role;

-- Migration 042: an imported entry carries MULTIPLE activities
--
-- Real reviewed data (Basecamp, August 2026) settled this: 3 of 14 entries
-- describe more than one kind of work. One 2h block was GBP Optimization +
-- Keyword Research & Strategy + Content Strategy; one 4h block was Technical
-- SEO Audit + Internal Linking Optimization. The hours were deliberately NOT
-- split — the whole block carries all of its tags. Multi-select here is
-- tagging, not splitting, so `hours` is untouched.
--
-- `activity_key` (migration 040) stays in place. This repo's migrations are
-- additive: the column is left behind and simply stops being read or written.
--
-- The same data also proved budget eligibility is NOT derivable from the
-- activity — Account Management & Comms was billable for two clients and
-- non-billable for two others, Internal Admin billable three times and
-- non-billable once. `counts_toward_budget` therefore stays an independent
-- column that the user's explicit choice owns; the activity set only ever
-- supplies a first-selection default, in application code.

alter table public.time_logs
  add column if not exists activity_keys text[] not null default '{}';

-- Carry forward whatever single activity a row already had. Zero rows match
-- today (context capture shipped after the last backfill), so this is a no-op
-- in production — but it must be correct for any environment that is not.
update public.time_logs
   set activity_keys = array[activity_key]
 where activity_key is not null
   and cardinality(activity_keys) = 0;

-- ---------------------------------------------------------------------------
-- Supersede the migration 041 RPC
--
-- 041 is already applied to production, so it is never edited in place. This
-- redefines the same function to whitelist and apply `activity_keys` instead
-- of `activity_key`. Everything else — the tenant guard, the duplicate-id
-- guard, the lock-then-write ordering, the internal-project forcing of
-- counts_toward_budget/client_id — is carried over unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.apply_timesheet_import_transition(
  p_organization_id uuid,
  p_ids uuid[],
  p_authorized_user_id uuid,
  p_expected_status text,
  p_updates jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target_count integer;
  v_changed_count integer;
  v_client_id uuid;
  v_activity_keys text[];
begin
  if p_organization_id is null
     or p_ids is null
     or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null
     or cardinality(p_ids) <> (
       select count(distinct requested_id)
       from unnest(p_ids) as requested(requested_id)
     ) then
    raise exception 'invalid timesheet import transition target'
      using errcode = '22023';
  end if;

  if p_expected_status not in ('needs_context', 'pending_review') then
    raise exception 'invalid timesheet import transition status'
      using errcode = '22023';
  end if;

  if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
    raise exception 'invalid timesheet import transition patch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_updates) as patch_key(key)
    where patch_key.key not in (
      'activity_keys',
      'description',
      'counts_toward_budget',
      'client_id',
      'import_status',
      'submitted_at',
      'submitted_by',
      'reviewed_at',
      'reviewed_by',
      'review_note'
    )
  ) then
    raise exception 'invalid timesheet import transition patch'
      using errcode = '22023';
  end if;

  if p_updates ? 'activity_keys' then
    if jsonb_typeof(p_updates -> 'activity_keys') <> 'array' then
      raise exception 'invalid timesheet import transition activities'
        using errcode = '22023';
    end if;

    select coalesce(array_agg(element.value order by element.ordinality), '{}'::text[])
      into v_activity_keys
      from jsonb_array_elements_text(p_updates -> 'activity_keys')
        with ordinality as element(value, ordinality);

    if array_position(v_activity_keys, null) is not null then
      raise exception 'invalid timesheet import transition activities'
        using errcode = '22023';
    end if;
  end if;

  if p_updates ? 'import_status'
     and coalesce(p_updates ->> 'import_status', '') not in (
       'needs_context',
       'pending_review',
       'mapped',
       'voided'
     ) then
    raise exception 'invalid timesheet import transition status'
      using errcode = '22023';
  end if;

  if p_updates ? 'client_id'
     and jsonb_typeof(p_updates -> 'client_id') <> 'null' then
    begin
      v_client_id := (p_updates ->> 'client_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'invalid timesheet import transition client'
          using errcode = '22023';
    end;

    perform clients.id
    from public.clients
    where clients.id = v_client_id
      and clients.organization_id = p_organization_id
    for key share;

    if not found then
      raise exception 'timesheet_import_transition_conflict'
        using errcode = 'P0001';
    end if;
  end if;

  -- Lock the complete authorized target set before deciding whether to write.
  select count(*)
    into v_target_count
    from (
      select time_logs.id
      from public.time_logs
      where time_logs.organization_id = p_organization_id
        and time_logs.id = any(p_ids)
        and time_logs.import_status = p_expected_status
        and (
          p_authorized_user_id is null
          or time_logs.user_id = p_authorized_user_id
        )
      for update
    ) as locked_targets;

  if v_target_count <> cardinality(p_ids) then
    raise exception 'timesheet_import_transition_conflict'
      using errcode = 'P0001';
  end if;

  update public.time_logs as target
     set activity_keys = case
           when p_updates ? 'activity_keys' then v_activity_keys
           else target.activity_keys
         end,
         description = case
           when p_updates ? 'description' then p_updates ->> 'description'
           else target.description
         end,
         counts_toward_budget = case
           when exists (
             select 1
             from public.basecamp_project_roles
             where basecamp_project_roles.organization_id = target.organization_id
               and basecamp_project_roles.basecamp_project_id = target.basecamp_project_id
               and basecamp_project_roles.role = 'internal'
           ) then false
           when p_updates ? 'counts_toward_budget'
             then (p_updates ->> 'counts_toward_budget')::boolean
           else target.counts_toward_budget
         end,
         client_id = case
           when exists (
             select 1
             from public.basecamp_project_roles
             where basecamp_project_roles.organization_id = target.organization_id
               and basecamp_project_roles.basecamp_project_id = target.basecamp_project_id
               and basecamp_project_roles.role = 'internal'
           ) then null
           when p_updates ? 'client_id' then v_client_id
           else target.client_id
         end,
         import_status = case
           when p_updates ? 'import_status' then p_updates ->> 'import_status'
           else target.import_status
         end,
         submitted_at = case
           when p_updates ? 'submitted_at' then (p_updates ->> 'submitted_at')::timestamptz
           else target.submitted_at
         end,
         submitted_by = case
           when p_updates ? 'submitted_by' then (p_updates ->> 'submitted_by')::uuid
           else target.submitted_by
         end,
         reviewed_at = case
           when p_updates ? 'reviewed_at' then (p_updates ->> 'reviewed_at')::timestamptz
           else target.reviewed_at
         end,
         reviewed_by = case
           when p_updates ? 'reviewed_by' then (p_updates ->> 'reviewed_by')::uuid
           else target.reviewed_by
         end,
         review_note = case
           when p_updates ? 'review_note' then p_updates ->> 'review_note'
           else target.review_note
         end
   where target.organization_id = p_organization_id
     and target.id = any(p_ids)
     and target.import_status = p_expected_status
     and (
       p_authorized_user_id is null
       or target.user_id = p_authorized_user_id
     );

  get diagnostics v_changed_count = row_count;
  if v_changed_count <> cardinality(p_ids) then
    -- Raising rolls this function call back, including any rows just updated.
    raise exception 'timesheet_import_transition_conflict'
      using errcode = 'P0001';
  end if;

  return v_changed_count;
end;
$$;

revoke execute on function public.apply_timesheet_import_transition(uuid, uuid[], uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_timesheet_import_transition(uuid, uuid[], uuid, text, jsonb)
  to service_role;

-- Migration 043: an imported entry carries structured document links
--
-- The team habitually attaches Google Docs to their time notes. A reviewed
-- August entry read "created updated SEO roadmap draft: All In One
-- Construction - 6-Month SEO Roadmap" where the doc name was a live
-- hyperlink. Buried in free text that artifact is unreadable by anything but
-- a human; as structured data a client-month review can list what was
-- actually produced that month.
--
-- jsonb rather than a child table: the links belong to the entry, are read
-- only with it, and are never queried across rows. Application code caps the
-- count and validates each URL against the same `safeHref` allowlist the
-- renderers use, so this column can never carry a `javascript:` href.

alter table public.time_logs
  add column if not exists reference_links jsonb not null default '[]'::jsonb;

-- The column is a LIST of links. Postgres would otherwise happily store a
-- bare object or a string here, and every reader downstream assumes an array.
do $$
begin
  alter table public.time_logs
    add constraint time_logs_reference_links_is_array
    check (jsonb_typeof(reference_links) = 'array');
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Supersede the migration 042 RPC
--
-- 041 defined this function and 042 redefined it; both are already applied to
-- production, so neither is ever edited in place. This third definition adds
-- `reference_links` to the patch-key whitelist and validates its shape.
-- Everything else — the tenant guard, the duplicate-id guard, the
-- lock-then-write ordering, the internal-project forcing of
-- counts_toward_budget/client_id — is carried over unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.apply_timesheet_import_transition(
  p_organization_id uuid,
  p_ids uuid[],
  p_authorized_user_id uuid,
  p_expected_status text,
  p_updates jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target_count integer;
  v_changed_count integer;
  v_client_id uuid;
  v_activity_keys text[];
begin
  if p_organization_id is null
     or p_ids is null
     or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null
     or cardinality(p_ids) <> (
       select count(distinct requested_id)
       from unnest(p_ids) as requested(requested_id)
     ) then
    raise exception 'invalid timesheet import transition target'
      using errcode = '22023';
  end if;

  if p_expected_status not in ('needs_context', 'pending_review') then
    raise exception 'invalid timesheet import transition status'
      using errcode = '22023';
  end if;

  if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
    raise exception 'invalid timesheet import transition patch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_updates) as patch_key(key)
    where patch_key.key not in (
      'activity_keys',
      'reference_links',
      'description',
      'counts_toward_budget',
      'client_id',
      'import_status',
      'submitted_at',
      'submitted_by',
      'reviewed_at',
      'reviewed_by',
      'review_note'
    )
  ) then
    raise exception 'invalid timesheet import transition patch'
      using errcode = '22023';
  end if;

  if p_updates ? 'activity_keys' then
    if jsonb_typeof(p_updates -> 'activity_keys') <> 'array' then
      raise exception 'invalid timesheet import transition activities'
        using errcode = '22023';
    end if;

    select coalesce(array_agg(element.value order by element.ordinality), '{}'::text[])
      into v_activity_keys
      from jsonb_array_elements_text(p_updates -> 'activity_keys')
        with ordinality as element(value, ordinality);

    if array_position(v_activity_keys, null) is not null then
      raise exception 'invalid timesheet import transition activities'
        using errcode = '22023';
    end if;
  end if;

  -- A reference link is a {label, url} object and nothing else. Both fields
  -- must be strings: a number or a nested object here would reach the review
  -- UI as an href, and the column is the artifact list a client-month review
  -- will read back.
  if p_updates ? 'reference_links' then
    if jsonb_typeof(p_updates -> 'reference_links') <> 'array' then
      raise exception 'invalid timesheet import transition reference links'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_updates -> 'reference_links') as link(value)
      where jsonb_typeof(link.value) <> 'object'
         or jsonb_typeof(link.value -> 'label') is distinct from 'string'
         or jsonb_typeof(link.value -> 'url') is distinct from 'string'
    ) then
      raise exception 'invalid timesheet import transition reference links'
        using errcode = '22023';
    end if;
  end if;

  if p_updates ? 'import_status'
     and coalesce(p_updates ->> 'import_status', '') not in (
       'needs_context',
       'pending_review',
       'mapped',
       'voided'
     ) then
    raise exception 'invalid timesheet import transition status'
      using errcode = '22023';
  end if;

  if p_updates ? 'client_id'
     and jsonb_typeof(p_updates -> 'client_id') <> 'null' then
    begin
      v_client_id := (p_updates ->> 'client_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'invalid timesheet import transition client'
          using errcode = '22023';
    end;

    perform clients.id
    from public.clients
    where clients.id = v_client_id
      and clients.organization_id = p_organization_id
    for key share;

    if not found then
      raise exception 'timesheet_import_transition_conflict'
        using errcode = 'P0001';
    end if;
  end if;

  -- Lock the complete authorized target set before deciding whether to write.
  select count(*)
    into v_target_count
    from (
      select time_logs.id
      from public.time_logs
      where time_logs.organization_id = p_organization_id
        and time_logs.id = any(p_ids)
        and time_logs.import_status = p_expected_status
        and (
          p_authorized_user_id is null
          or time_logs.user_id = p_authorized_user_id
        )
      for update
    ) as locked_targets;

  if v_target_count <> cardinality(p_ids) then
    raise exception 'timesheet_import_transition_conflict'
      using errcode = 'P0001';
  end if;

  update public.time_logs as target
     set activity_keys = case
           when p_updates ? 'activity_keys' then v_activity_keys
           else target.activity_keys
         end,
         reference_links = case
           when p_updates ? 'reference_links' then p_updates -> 'reference_links'
           else target.reference_links
         end,
         description = case
           when p_updates ? 'description' then p_updates ->> 'description'
           else target.description
         end,
         counts_toward_budget = case
           when exists (
             select 1
             from public.basecamp_project_roles
             where basecamp_project_roles.organization_id = target.organization_id
               and basecamp_project_roles.basecamp_project_id = target.basecamp_project_id
               and basecamp_project_roles.role = 'internal'
           ) then false
           when p_updates ? 'counts_toward_budget'
             then (p_updates ->> 'counts_toward_budget')::boolean
           else target.counts_toward_budget
         end,
         client_id = case
           when exists (
             select 1
             from public.basecamp_project_roles
             where basecamp_project_roles.organization_id = target.organization_id
               and basecamp_project_roles.basecamp_project_id = target.basecamp_project_id
               and basecamp_project_roles.role = 'internal'
           ) then null
           when p_updates ? 'client_id' then v_client_id
           else target.client_id
         end,
         import_status = case
           when p_updates ? 'import_status' then p_updates ->> 'import_status'
           else target.import_status
         end,
         submitted_at = case
           when p_updates ? 'submitted_at' then (p_updates ->> 'submitted_at')::timestamptz
           else target.submitted_at
         end,
         submitted_by = case
           when p_updates ? 'submitted_by' then (p_updates ->> 'submitted_by')::uuid
           else target.submitted_by
         end,
         reviewed_at = case
           when p_updates ? 'reviewed_at' then (p_updates ->> 'reviewed_at')::timestamptz
           else target.reviewed_at
         end,
         reviewed_by = case
           when p_updates ? 'reviewed_by' then (p_updates ->> 'reviewed_by')::uuid
           else target.reviewed_by
         end,
         review_note = case
           when p_updates ? 'review_note' then p_updates ->> 'review_note'
           else target.review_note
         end
   where target.organization_id = p_organization_id
     and target.id = any(p_ids)
     and target.import_status = p_expected_status
     and (
       p_authorized_user_id is null
       or target.user_id = p_authorized_user_id
     );

  get diagnostics v_changed_count = row_count;
  if v_changed_count <> cardinality(p_ids) then
    -- Raising rolls this function call back, including any rows just updated.
    raise exception 'timesheet_import_transition_conflict'
      using errcode = 'P0001';
  end if;

  return v_changed_count;
end;
$$;

revoke execute on function public.apply_timesheet_import_transition(uuid, uuid[], uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_timesheet_import_transition(uuid, uuid[], uuid, text, jsonb)
  to service_role;

-- Migration 044: an imported entry can be linked to a task
--
-- A teammate's reviewed August notes repeatedly reference Basecamp to-dos
-- ("Checked off Basecamp to-do's", "Added roadmap To-do's to basecamp"), yet
-- zero of his fourteen imported entries carry a task link: every one was
-- logged at the Basecamp PROJECT level rather than against a to-do, so the
-- CSV has nothing to attach.
--
-- The link therefore has to be made during review, and it is made in SEO PM
-- only. A Basecamp timesheet entry cannot be re-parented in place --
-- `updateBasecampTimesheetEntry` accepts date/hours/description/person and
-- nothing else -- and deleting and recreating it would mint a new
-- `basecamp_entry_id`, destroying the dedupe identity the whole import design
-- rests on. So `time_logs.task_id` carries the attribution and the Basecamp
-- entry stays exactly where it is.
--
-- No new column: `time_logs.task_id` has existed since 001. What is new is
-- that the review RPC may write it.
--
-- ---------------------------------------------------------------------------
-- Supersede the migration 043 RPC
--
-- 041 defined this function, 042 and 043 redefined it; all three are already
-- applied to production, so none is ever edited in place. This fourth
-- definition adds `task_id` to the patch-key whitelist and validates that the
-- referenced task exists, belongs to `p_organization_id`, and belongs to the
-- same client as every row being patched. Every earlier guard -- the tenant
-- scope, the duplicate-id guard, the lock-then-write ordering, the
-- internal-project forcing of counts_toward_budget/client_id, the activity
-- and reference-link shape checks -- is carried over unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.apply_timesheet_import_transition(
  p_organization_id uuid,
  p_ids uuid[],
  p_authorized_user_id uuid,
  p_expected_status text,
  p_updates jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target_count integer;
  v_changed_count integer;
  v_client_id uuid;
  v_activity_keys text[];
  v_task_id uuid;
  v_task_client_id uuid;
begin
  if p_organization_id is null
     or p_ids is null
     or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null
     or cardinality(p_ids) <> (
       select count(distinct requested_id)
       from unnest(p_ids) as requested(requested_id)
     ) then
    raise exception 'invalid timesheet import transition target'
      using errcode = '22023';
  end if;

  if p_expected_status not in ('needs_context', 'pending_review') then
    raise exception 'invalid timesheet import transition status'
      using errcode = '22023';
  end if;

  if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
    raise exception 'invalid timesheet import transition patch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_updates) as patch_key(key)
    where patch_key.key not in (
      'activity_keys',
      'reference_links',
      'task_id',
      'description',
      'counts_toward_budget',
      'client_id',
      'import_status',
      'submitted_at',
      'submitted_by',
      'reviewed_at',
      'reviewed_by',
      'review_note'
    )
  ) then
    raise exception 'invalid timesheet import transition patch'
      using errcode = '22023';
  end if;

  if p_updates ? 'activity_keys' then
    if jsonb_typeof(p_updates -> 'activity_keys') <> 'array' then
      raise exception 'invalid timesheet import transition activities'
        using errcode = '22023';
    end if;

    select coalesce(array_agg(element.value order by element.ordinality), '{}'::text[])
      into v_activity_keys
      from jsonb_array_elements_text(p_updates -> 'activity_keys')
        with ordinality as element(value, ordinality);

    if array_position(v_activity_keys, null) is not null then
      raise exception 'invalid timesheet import transition activities'
        using errcode = '22023';
    end if;
  end if;

  -- A reference link is a {label, url} object and nothing else. Both fields
  -- must be strings: a number or a nested object here would reach the review
  -- UI as an href, and the column is the artifact list a client-month review
  -- will read back.
  if p_updates ? 'reference_links' then
    if jsonb_typeof(p_updates -> 'reference_links') <> 'array' then
      raise exception 'invalid timesheet import transition reference links'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_updates -> 'reference_links') as link(value)
      where jsonb_typeof(link.value) <> 'object'
         or jsonb_typeof(link.value -> 'label') is distinct from 'string'
         or jsonb_typeof(link.value -> 'url') is distinct from 'string'
    ) then
      raise exception 'invalid timesheet import transition reference links'
        using errcode = '22023';
    end if;
  end if;

  if p_updates ? 'import_status'
     and coalesce(p_updates ->> 'import_status', '') not in (
       'needs_context',
       'pending_review',
       'mapped',
       'voided'
     ) then
    raise exception 'invalid timesheet import transition status'
      using errcode = '22023';
  end if;

  if p_updates ? 'client_id'
     and jsonb_typeof(p_updates -> 'client_id') <> 'null' then
    begin
      v_client_id := (p_updates ->> 'client_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'invalid timesheet import transition client'
          using errcode = '22023';
    end;

    perform clients.id
    from public.clients
    where clients.id = v_client_id
      and clients.organization_id = p_organization_id
    for key share;

    if not found then
      raise exception 'timesheet_import_transition_conflict'
        using errcode = 'P0001';
    end if;
  end if;

  -- A task link may only point at a task inside this tenant. Resolved and
  -- locked exactly the way `client_id` is, so a task deleted or moved mid
  -- review cannot be linked by a racing patch.
  if p_updates ? 'task_id'
     and jsonb_typeof(p_updates -> 'task_id') <> 'null' then
    begin
      v_task_id := (p_updates ->> 'task_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'invalid timesheet import transition task'
          using errcode = '22023';
    end;

    select tasks.client_id
      into v_task_client_id
      from public.tasks
      where tasks.id = v_task_id
        and tasks.organization_id = p_organization_id
      for key share;

    if not found then
      raise exception 'timesheet_import_transition_conflict'
        using errcode = 'P0001';
    end if;
  end if;

  -- Lock the complete authorized target set before deciding whether to write.
  select count(*)
    into v_target_count
    from (
      select time_logs.id
      from public.time_logs
      where time_logs.organization_id = p_organization_id
        and time_logs.id = any(p_ids)
        and time_logs.import_status = p_expected_status
        and (
          p_authorized_user_id is null
          or time_logs.user_id = p_authorized_user_id
        )
      for update
    ) as locked_targets;

  if v_target_count <> cardinality(p_ids) then
    raise exception 'timesheet_import_transition_conflict'
      using errcode = 'P0001';
  end if;

  -- The task must belong to the SAME client as every row being patched,
  -- counting the client this very patch sets. Linking a task from another
  -- client would silently mis-attribute billable time to that client's work.
  if p_updates ? 'task_id' and v_task_id is not null then
    if exists (
      select 1
      from public.time_logs
      where time_logs.organization_id = p_organization_id
        and time_logs.id = any(p_ids)
        and (case
               when p_updates ? 'client_id' then v_client_id
               else time_logs.client_id
             end) is distinct from v_task_client_id
    ) then
      raise exception 'timesheet_import_transition_conflict'
        using errcode = 'P0001';
    end if;
  end if;

  update public.time_logs as target
     set activity_keys = case
           when p_updates ? 'activity_keys' then v_activity_keys
           else target.activity_keys
         end,
         task_id = case
           when p_updates ? 'task_id' then v_task_id
           else target.task_id
         end,
         reference_links = case
           when p_updates ? 'reference_links' then p_updates -> 'reference_links'
           else target.reference_links
         end,
         description = case
           when p_updates ? 'description' then p_updates ->> 'description'
           else target.description
         end,
         counts_toward_budget = case
           when exists (
             select 1
             from public.basecamp_project_roles
             where basecamp_project_roles.organization_id = target.organization_id
               and basecamp_project_roles.basecamp_project_id = target.basecamp_project_id
               and basecamp_project_roles.role = 'internal'
           ) then false
           when p_updates ? 'counts_toward_budget'
             then (p_updates ->> 'counts_toward_budget')::boolean
           else target.counts_toward_budget
         end,
         client_id = case
           when exists (
             select 1
             from public.basecamp_project_roles
             where basecamp_project_roles.organization_id = target.organization_id
               and basecamp_project_roles.basecamp_project_id = target.basecamp_project_id
               and basecamp_project_roles.role = 'internal'
           ) then null
           when p_updates ? 'client_id' then v_client_id
           else target.client_id
         end,
         import_status = case
           when p_updates ? 'import_status' then p_updates ->> 'import_status'
           else target.import_status
         end,
         submitted_at = case
           when p_updates ? 'submitted_at' then (p_updates ->> 'submitted_at')::timestamptz
           else target.submitted_at
         end,
         submitted_by = case
           when p_updates ? 'submitted_by' then (p_updates ->> 'submitted_by')::uuid
           else target.submitted_by
         end,
         reviewed_at = case
           when p_updates ? 'reviewed_at' then (p_updates ->> 'reviewed_at')::timestamptz
           else target.reviewed_at
         end,
         reviewed_by = case
           when p_updates ? 'reviewed_by' then (p_updates ->> 'reviewed_by')::uuid
           else target.reviewed_by
         end,
         review_note = case
           when p_updates ? 'review_note' then p_updates ->> 'review_note'
           else target.review_note
         end
   where target.organization_id = p_organization_id
     and target.id = any(p_ids)
     and target.import_status = p_expected_status
     and (
       p_authorized_user_id is null
       or target.user_id = p_authorized_user_id
     );

  get diagnostics v_changed_count = row_count;
  if v_changed_count <> cardinality(p_ids) then
    -- Raising rolls this function call back, including any rows just updated.
    raise exception 'timesheet_import_transition_conflict'
      using errcode = 'P0001';
  end if;

  return v_changed_count;
end;
$$;

revoke execute on function public.apply_timesheet_import_transition(uuid, uuid[], uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_timesheet_import_transition(uuid, uuid[], uuid, text, jsonb)
  to service_role;
