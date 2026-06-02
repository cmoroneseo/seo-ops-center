-- =============================================================================
-- Migration 003: SEO Ops domain — phase out the Command Center workbook
-- =============================================================================
-- Generated: 2026-06-01
-- Plan: ~/.claude/plans/we-are-at-a-harmonic-duckling.md ; Stage 0 spec:
--       docs/seo-ops-migration-spec.md
--
-- Makes the app the system of record for ops/PM data by:
--   * extending public.clients into the "Client Overview" master record
--     (+ Client Campaigns + Client Analytics Map fields, + custom_fields)
--   * adding public.deliverables       (Deliverables Tracker)
--   * adding public.client_change_log  (Client Change Log — now auto via trigger)
--   * adding public.team_bonus         (SEO Team Bonus Tracker — admin-only)
--   * adding organizations.is_internal (internal/comp billing bypass)
--
-- Hours (Daily Hours Log) and Monthly Planners reuse the existing time_logs and
-- monthly_plans tables unchanged. Derived sheets (Monthly SEO Summary, Dashboard,
-- Department Metrics, Client List) are rebuilt as app queries — no tables here.
--
-- Idempotent and safe to re-run. Mirrors the changes folded into schema.sql.
-- =============================================================================


-- =============================================================================
-- A. Organizations — internal/comp flag (billing bypass for Marketing Empire Group)
-- =============================================================================
alter table public.organizations
  add column if not exists is_internal boolean not null default false;


-- =============================================================================
-- B. Clients — extend into the master "Client Overview" record
-- =============================================================================
alter table public.clients
  add column if not exists client_slug            text,
  add column if not exists launch_date            date,
  add column if not exists original_launch_date   date,
  add column if not exists launch_date_override   date,
  add column if not exists seo_hours              numeric(6, 2),
  add column if not exists engagement_model       text,
  add column if not exists deliverables_spec      text,
  add column if not exists blogs_due_per_month    numeric(4, 1),
  add column if not exists account_manager_id     uuid references public.users(id),
  add column if not exists account_manager_name   text,
  add column if not exists tier                   smallint,
  add column if not exists target_blog_count      integer,
  add column if not exists delivered_override     integer,
  add column if not exists notes                  text,
  add column if not exists planning_tags          text,
  add column if not exists campaign_start         date,
  add column if not exists campaign_end           date,
  add column if not exists campaign_total_blogs   integer,
  add column if not exists campaign_total_hours   numeric(7, 2),
  add column if not exists ga4_property_id        text,
  add column if not exists gsc_url                text,
  add column if not exists custom_fields          jsonb not null default '{}'::jsonb;

-- Constraints added separately so re-runs don't error if they already exist.
do $$ begin
  alter table public.clients
    add constraint clients_engagement_model_check
    check (engagement_model is null or engagement_model in ('Retainer', 'Campaign'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.clients
    add constraint clients_tier_check
    check (tier is null or tier in (1, 2, 3));
exception when duplicate_object then null; end $$;

-- client_slug is the workbook import join key; unique per org. Non-partial so it
-- can serve as an upsert ON CONFLICT target (Postgres treats NULL slugs as
-- distinct, so non-imported clients with NULL slug don't collide).
create unique index if not exists clients_org_slug_uniq
  on public.clients (organization_id, client_slug);


-- =============================================================================
-- C. Deliverables (← "Deliverables Tracker")
-- =============================================================================
create table if not exists public.deliverables (
  id                  uuid default uuid_generate_v4() primary key,
  organization_id     uuid references public.organizations(id) on delete cascade not null,
  client_id           uuid references public.clients(id) on delete cascade not null,
  title               text not null,
  type                text check (type in ('Content', 'Backlink', 'GBP', 'Other')) default 'Content',
  status              text check (status in ('Pending', 'In Progress', 'Review', 'Approved', 'Published')) default 'Pending',
  due_date            date,
  month               text,           -- 'YYYY-MM' for fast monthly rollups
  account_manager_id  uuid references public.users(id),
  counts_toward_hours boolean default true,
  notes               text,
  delivered_on        timestamp with time zone,
  status_history      jsonb not null default '[]'::jsonb,  -- [{status, at}] for cycle-time analytics
  custom_fields       jsonb not null default '{}'::jsonb,
  created_at          timestamp with time zone default timezone('utc'::text, now()) not null
);
create index if not exists deliverables_client_month_idx on public.deliverables (client_id, month);
create index if not exists deliverables_org_idx on public.deliverables (organization_id);


-- =============================================================================
-- D. Client Change Log (← "Client Change Log") — written automatically (see G)
-- =============================================================================
create table if not exists public.client_change_log (
  id               uuid default uuid_generate_v4() primary key,
  organization_id  uuid references public.organizations(id) on delete cascade not null,
  client_id        uuid references public.clients(id) on delete cascade not null,
  date_of_change   timestamp with time zone default timezone('utc'::text, now()) not null,
  changed_by_id    uuid references public.users(id),
  prev_seo_hours   numeric(6, 2),
  new_seo_hours    numeric(6, 2),
  prev_blog_count  numeric(4, 1),
  new_blog_count   numeric(4, 1),
  effective_date   date,
  notes            text,
  created_at       timestamp with time zone default timezone('utc'::text, now()) not null
);
create index if not exists client_change_log_client_idx on public.client_change_log (client_id);


-- =============================================================================
-- E. Team Bonus (← "SEO Team Bonus Tracker") — admin-only via RLS
-- =============================================================================
create table if not exists public.team_bonus (
  id               uuid default uuid_generate_v4() primary key,
  organization_id  uuid references public.organizations(id) on delete cascade not null,
  user_id          uuid references public.users(id),
  member_name      text,             -- fallback when no user row yet
  month            text not null,    -- 'YYYY-MM'
  base_from_hours  numeric(8, 2) default 0,
  kpi_bonus        numeric(8, 2) default 0,
  cap              numeric(8, 2) default 300,
  notes            text,
  created_at       timestamp with time zone default timezone('utc'::text, now()) not null
);
create index if not exists team_bonus_org_month_idx on public.team_bonus (organization_id, month);


-- =============================================================================
-- F. Row Level Security for the new tables
-- =============================================================================
alter table public.deliverables      enable row level security;
alter table public.client_change_log enable row level security;
alter table public.team_bonus        enable row level security;

-- Deliverables + change log: any org member can manage (mirrors clients policy).
drop policy if exists "Org members can manage deliverables" on public.deliverables;
create policy "Org members can manage deliverables"
  on public.deliverables for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

drop policy if exists "Org members can manage client_change_log" on public.client_change_log;
create policy "Org members can manage client_change_log"
  on public.client_change_log for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

-- Team bonus: compensation data — owner/admin only (members/viewers can't read).
drop policy if exists "Admins can manage team_bonus" on public.team_bonus;
create policy "Admins can manage team_bonus"
  on public.team_bonus for all
  using      ( organization_id in (select public.get_user_admin_org_ids()) )
  with check ( organization_id in (select public.get_user_admin_org_ids()) );


-- =============================================================================
-- G. Auto change-log: write a client_change_log row when budget/cadence changes
-- -----------------------------------------------------------------------------
-- Replaces the hand-typed sheet. Fires only when seo_hours or
-- blogs_due_per_month actually change. changed_by_id = auth.uid() (the editor).
-- The bulk importer sets a session GUC (app.suppress_change_log='on') to skip
-- this during historical load, since those rows are inserted explicitly.
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
-- End of migration 003
-- =============================================================================
