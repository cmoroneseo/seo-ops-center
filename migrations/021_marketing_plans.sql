-- =============================================================================
-- 021: SEO Marketing Plan — SE Ranking-style checklist (replaces Campaign Plan UI)
-- =============================================================================
-- One plan per client, seeded from a 7-step template. Items are checklist
-- entries promotable to real tasks via task_id. campaign_* tables are
-- untouched (UI unmounted, data preserved).
-- =============================================================================

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
