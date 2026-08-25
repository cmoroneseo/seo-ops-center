-- Migration 038: timesheet ledger provenance + immutable client-month approvals
--
-- time_logs stays the one canonical ledger. This migration adds:
--   * where a row came from (source) and how far its import got (import_status)
--   * provider timestamps so a later Basecamp edit is detectable
--   * the hard deduplication invariant on basecamp_entry_id
--   * client/month approval snapshots that are never rewritten in place
-- All provider-controlled columns are service-role only, matching migration 032.

-- ---------------------------------------------------------------------------
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
