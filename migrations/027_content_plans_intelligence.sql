-- =============================================================================
-- 027: Content Plans & Client Intelligence
-- =============================================================================

create table public.client_intelligence (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null unique,
  status text not null default 'draft' check (status in ('draft', 'ready')),
  version integer not null default 1 check (version > 0),
  business jsonb not null default '{}'::jsonb,
  offers jsonb not null default '{}'::jsonb,
  audiences jsonb not null default '{}'::jsonb,
  markets jsonb not null default '{}'::jsonb,
  seo_context jsonb not null default '{}'::jsonb,
  brand_constraints jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index client_intelligence_org_idx on public.client_intelligence (organization_id);
create index client_intelligence_client_idx on public.client_intelligence (client_id);

create table public.content_plans (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  client_id uuid references public.clients(id) on delete cascade not null,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  period_start date,
  period_end date,
  intelligence_version integer,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  check (period_end is null or period_start is null or period_end >= period_start)
);
create index content_plans_org_idx on public.content_plans (organization_id, updated_at desc);
create index content_plans_client_idx on public.content_plans (client_id, status);

create table public.topic_clusters (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  content_plan_id uuid references public.content_plans(id) on delete cascade not null,
  name text not null,
  seed_keyword text,
  primary_keyword text,
  primary_target_type text,
  primary_target_url text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  business_value integer check (business_value between 1 and 5),
  sort_order integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index topic_clusters_plan_idx on public.topic_clusters (content_plan_id, sort_order);
create index topic_clusters_org_idx on public.topic_clusters (organization_id);

create table public.content_opportunities (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  content_plan_id uuid references public.content_plans(id) on delete cascade not null,
  topic_cluster_id uuid references public.topic_clusters(id) on delete set null,
  opportunity_type text not null check (opportunity_type in (
    'landing_page', 'supporting_article', 'location_page', 'existing_page_refresh',
    'faq_addition', 'comparison_case_study', 'consolidate_redirect', 'no_action'
  )),
  keyword text,
  working_title text not null,
  search_intent text check (search_intent is null or search_intent in ('informational', 'commercial', 'transactional', 'navigational')),
  status text not null default 'suggested' check (status in ('suggested', 'approved', 'rejected', 'promoted', 'published')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  existing_url text,
  target_url text,
  is_question boolean not null default false,
  task_id uuid references public.tasks(id) on delete set null,
  deliverable_id uuid references public.deliverables(id) on delete set null,
  assignee_id uuid references public.users(id) on delete set null,
  due_date date,
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index content_opportunities_plan_idx on public.content_opportunities (content_plan_id, status);
create index content_opportunities_cluster_idx on public.content_opportunities (topic_cluster_id);
create index content_opportunities_org_idx on public.content_opportunities (organization_id);
create index content_opportunities_task_idx on public.content_opportunities (task_id) where task_id is not null;
create index content_opportunities_deliverable_idx on public.content_opportunities (deliverable_id) where deliverable_id is not null;

alter table public.client_intelligence enable row level security;
alter table public.content_plans enable row level security;
alter table public.topic_clusters enable row level security;
alter table public.content_opportunities enable row level security;

create policy "Org members can manage client intelligence"
  on public.client_intelligence for all
  using (organization_id in (select get_user_org_ids()))
  with check (organization_id in (select get_user_org_ids()));

create policy "Org members can manage content plans"
  on public.content_plans for all
  using (organization_id in (select get_user_org_ids()))
  with check (organization_id in (select get_user_org_ids()));

create policy "Org members can manage topic clusters"
  on public.topic_clusters for all
  using (organization_id in (select get_user_org_ids()))
  with check (organization_id in (select get_user_org_ids()));

create policy "Org members can manage content opportunities"
  on public.content_opportunities for all
  using (organization_id in (select get_user_org_ids()))
  with check (organization_id in (select get_user_org_ids()));
