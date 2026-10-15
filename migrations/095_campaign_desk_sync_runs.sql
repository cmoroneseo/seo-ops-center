-- 095: Campaign Desk forecast sync runs. Not applied in this change.
--
-- Apply after 094. This migration creates one new table, two indexes, and a
-- read policy. It does not alter time_logs, tasks, planner_events, clients,
-- or any existing row, and it does not lock those tables.
--
-- The application writes a row only after an owner or admin confirms a sync
-- and only when CAMPAIGN_DESK_SYNC_ENABLED is exactly true, the organization
-- is listed in CAMPAIGN_DESK_ORG_IDS, and the Campaign Desk URL and token are
-- set. Leave the flag off until those exist. Do not add the production
-- organization to the allowlist until a sandbox sync has been checked.
--
-- There is no cron. A browser session cannot insert or update this table.

create table public.campaign_desk_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  week_starts date[] not null,
  payload_hash text not null,
  payload jsonb not null,
  status text not null,
  external_id text,
  undone_at timestamptz,
  undone_by uuid references public.users(id),
  check (cardinality(week_starts) between 1 and 4),
  check (payload_hash ~ '^[a-f0-9]{64}$'),
  check (status in ('succeeded', 'undone')),
  check ((status = 'undone') = (undone_at is not null)),
  check (status <> 'undone' or undone_by is not null),
  check (jsonb_typeof(payload) = 'object'),
  check (external_id is null or length(btrim(external_id)) > 0)
);

create index campaign_desk_sync_runs_org_created_idx
  on public.campaign_desk_sync_runs (organization_id, created_at desc);

-- One live success per payload. Undoing a run drops it out of this index, so
-- the same hours can be sent again later. A repeat while the row is still
-- succeeded is reused instead of inserted.
create unique index campaign_desk_sync_runs_live_hash_idx
  on public.campaign_desk_sync_runs (organization_id, payload_hash)
  where status = 'succeeded';

alter table public.campaign_desk_sync_runs enable row level security;

-- Owners and admins can read sync history for their own organization.
-- Inserts and updates happen only through the service role, after the API
-- route has checked the caller is an owner or admin.
create policy "Managers can read campaign desk sync runs"
  on public.campaign_desk_sync_runs for select
  using (
    organization_id in (select public.get_user_org_ids())
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = campaign_desk_sync_runs.organization_id
        and member.user_id = auth.uid()
        and member.role in ('owner', 'admin')
    )
  );

revoke all on table public.campaign_desk_sync_runs from public, anon, authenticated;
grant select on table public.campaign_desk_sync_runs to authenticated;
grant select, insert, update, delete on table public.campaign_desk_sync_runs to service_role;
