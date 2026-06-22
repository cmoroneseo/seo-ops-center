-- =============================================================================
-- 019: Campaign Plans — onboarding + strategy planning module
-- =============================================================================
-- Adds campaign_plans, campaign_goals, campaign_kpis, campaign_workstreams,
-- campaign_phases, and campaign_expectations. Direct FKs on tasks and
-- deliverable_commitments link execution back to the plan.
-- =============================================================================

-- 1. Campaign Plans (one active per client)
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

-- 2. Campaign Goals
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

-- 3. Campaign KPIs
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

-- 4. Campaign Workstreams
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

-- 5. Campaign Phases
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

-- 6. Campaign Expectations
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

-- 7. Link phases to workstreams (many-to-many)
create table public.campaign_phase_workstreams (
  phase_id uuid references public.campaign_phases(id) on delete cascade not null,
  workstream_id uuid references public.campaign_workstreams(id) on delete cascade not null,
  primary key (phase_id, workstream_id)
);

-- 8. Direct FK on tasks for campaign phase linkage (avoids extra join table)
alter table public.tasks
  add column campaign_phase_id uuid references public.campaign_phases(id) on delete set null;
create index tasks_campaign_phase_idx on public.tasks (campaign_phase_id)
  where campaign_phase_id is not null;

-- =============================================================================
-- Row Level Security
-- =============================================================================
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

-- Phase-workstream join: org membership checked via the parent tables' RLS
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
