-- =============================================================================
-- seo-ops-center — canonical database schema
-- =============================================================================
-- This is the from-scratch schema for a fresh Supabase project. It already
-- incorporates the fixes shipped as incremental migrations against the live DB:
--   migrations/001_init_seo_ops_schema.sql  (full schema + complete RLS policies)
--   migrations/002_fix_rls_policies.sql      (org read-back + members recursion fix)
-- Running this file on an empty project yields the same state as 001 + 002.
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
create table public.clients (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  name text not null,
  domain text,
  logo_url text,
  status text check (status in ('active', 'inactive', 'pending')) default 'active',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

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
