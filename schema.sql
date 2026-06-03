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
  created_by uuid default auth.uid()
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
  status text check (status in ('active', 'inactive', 'pending')) default 'active',
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
create table public.reports (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete cascade not null,
  summary text,
  insights text,
  status text check (status in ('draft', 'published')) default 'draft',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

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
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
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
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index deliverables_client_month_idx on public.deliverables (client_id, month);
create index deliverables_org_idx on public.deliverables (organization_id);

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


-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;
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
  with check ( true );

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

-- Bootstrap: a brand-new user can insert their own (owner) membership during setup.
create policy "Authenticated users can join organizations during setup"
  on public.organization_members for insert
  to authenticated
  with check ( auth.uid() = user_id );

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
