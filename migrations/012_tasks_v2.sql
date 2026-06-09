-- =============================================================================
-- Migration 012: Tasks V2 — full task management system
-- =============================================================================
-- Extends the stub tasks table into a production-grade entity with:
--   * client_id (denormalized, same pattern as deliverables + time_logs)
--   * priority, category, tags
--   * multi-assignee (assignee_ids UUID[])
--   * optional deliverable link
--   * subtask support via parent_task_id
--   * automation-ready fields: status_history, recurrence, template_id
--   * Basecamp sync columns (Phase 2 — present but unused until then)
--   * new: task_templates table
--   * new: task_comments table
-- Idempotent. Safe to re-run.
-- =============================================================================


-- =============================================================================
-- A. Extend tasks table
-- =============================================================================

-- Client denormalization (fast client-scoped queries; same pattern as deliverables/time_logs)
alter table public.tasks
  add column if not exists client_id uuid references public.clients(id) on delete cascade;

-- Priority & categorization
alter table public.tasks
  add column if not exists priority text default 'medium',
  add column if not exists category text,
  add column if not exists tags     text[] not null default '{}';

-- Priority constraint added separately so re-runs don't error
do $$ begin
  alter table public.tasks
    add constraint tasks_priority_check
    check (priority in ('low', 'medium', 'high', 'urgent'));
exception when duplicate_object then null; end $$;

-- Multi-assignee (TypeScript types already expect string[])
-- assignee_id kept for backward compat; new code writes assignee_ids
alter table public.tasks
  add column if not exists assignee_ids uuid[] not null default '{}';

-- Optional deliverable link — tasks are "how"; deliverables are "what"
alter table public.tasks
  add column if not exists deliverable_id uuid references public.deliverables(id) on delete set null;

-- Subtask support
alter table public.tasks
  add column if not exists parent_task_id uuid references public.tasks(id) on delete cascade,
  add column if not exists sort_order     integer not null default 0;

-- Time & scheduling
alter table public.tasks
  add column if not exists estimated_hours numeric(5,2),
  add column if not exists start_date      date,
  add column if not exists completed_at    timestamp with time zone;

-- Automation-ready infrastructure (schema now, UI in Phase 2)
alter table public.tasks
  add column if not exists created_by     uuid references public.users(id) on delete set null,
  add column if not exists template_id    uuid,           -- FK to task_templates added after that table is created
  add column if not exists recurrence     jsonb,          -- { freq: 'monthly', dayOfMonth: 1, endDate: null }
  add column if not exists status_history jsonb not null default '[]'::jsonb,  -- [{status, at, by}]
  add column if not exists custom_fields  jsonb not null default '{}'::jsonb,
  add column if not exists watcher_ids    uuid[] not null default '{}';

-- Basecamp sync (Phase 2 — columns present but unused until integration is built)
alter table public.tasks
  add column if not exists basecamp_todo_id    bigint,
  add column if not exists basecamp_project_id bigint,
  add column if not exists last_synced_at      timestamp with time zone;

-- Widen status to include 'approved' and 'blocked'
-- Drop the existing check constraint and recreate with the full set
do $$ begin
  alter table public.tasks drop constraint tasks_status_check;
exception when undefined_object then null; end $$;

do $$ begin
  alter table public.tasks
    add constraint tasks_status_check
    check (status in ('todo', 'in_progress', 'review', 'approved', 'blocked', 'done'));
exception when duplicate_object then null; end $$;


-- =============================================================================
-- B. task_templates — reusable SEO task blueprints
-- =============================================================================
create table if not exists public.task_templates (
  id              uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  name            text not null,
  description     text,
  category        text,
  estimated_hours numeric(5,2),
  priority        text default 'medium',
  tags            text[] not null default '{}',
  checklist       jsonb not null default '[]'::jsonb,  -- [{title, required}]
  recurrence      jsonb,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamp with time zone default timezone('utc'::text, now()) not null
);


-- =============================================================================
-- C. task_comments — persistent comments per task
-- Separate from time_logs.session_notes (those are in-timer scratch notes).
-- =============================================================================
create table if not exists public.task_comments (
  id                  uuid default uuid_generate_v4() primary key,
  organization_id     uuid references public.organizations(id) on delete cascade not null,
  task_id             uuid references public.tasks(id) on delete cascade not null,
  author_id           uuid references public.users(id) on delete set null,
  author_name         text,            -- fallback display name
  body                text not null,
  mentions            uuid[] not null default '{}',   -- user IDs @-mentioned
  basecamp_comment_id bigint,          -- Phase 2 Basecamp sync
  created_at          timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at          timestamp with time zone default timezone('utc'::text, now()) not null
);


-- =============================================================================
-- D. Wire template_id FK now that task_templates exists
-- =============================================================================
do $$ begin
  alter table public.tasks
    add constraint tasks_template_id_fkey
    foreign key (template_id) references public.task_templates(id) on delete set null;
exception when duplicate_object then null; end $$;


-- =============================================================================
-- E. Indexes
-- =============================================================================

-- Fast client-scoped task queries (excludes done — active tasks only)
create index if not exists tasks_client_status_idx
  on public.tasks (client_id, status)
  where status != 'done';

-- Fast assignee lookup (GIN for array containment queries)
create index if not exists tasks_assignee_idx
  on public.tasks using gin (assignee_ids);

-- Overdue / upcoming queries (org-wide, excludes done)
create index if not exists tasks_due_date_idx
  on public.tasks (organization_id, due_date)
  where status != 'done';

-- Subtask lookups
create index if not exists tasks_parent_idx
  on public.tasks (parent_task_id)
  where parent_task_id is not null;

-- Comment timeline per task
create index if not exists task_comments_task_idx
  on public.task_comments (task_id, created_at desc);

-- Template lookup per org
create index if not exists task_templates_org_idx
  on public.task_templates (organization_id);


-- =============================================================================
-- F. Row Level Security
-- =============================================================================
alter table public.task_templates enable row level security;
alter table public.task_comments  enable row level security;

-- task_templates: org members can fully manage
drop policy if exists "Org members can manage task_templates" on public.task_templates;
create policy "Org members can manage task_templates"
  on public.task_templates for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

-- task_comments: org members can fully manage
drop policy if exists "Org members can manage task_comments" on public.task_comments;
create policy "Org members can manage task_comments"
  on public.task_comments for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );
