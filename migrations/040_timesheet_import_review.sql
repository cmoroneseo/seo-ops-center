-- Migration 040: import context capture + review workflow
--
-- Adds the member-enrichment stage between "imported" and "counts". Also adds
-- CSV identity (import_fingerprint), because Basecamp's timesheet CSV export
-- carries no entry id, and an explicit project->client role table, replacing
-- the misused basecamp_timesheet_enabled push flag as the import gate.
--
-- Numbered 040, not 039: 039 was already taken by organization_theme.sql
-- (brand theming, applied Aug 25, 2026) by the time this migration was
-- written.

-- ---------------------------------------------------------------------------
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
