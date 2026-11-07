-- Migration 117: report tracking snapshots (PR 1.8).
--
-- NOT APPLIED. Do not run this against the production Supabase project
-- (sgszojorcftyaknruckh). The owner reviews and applies it separately.
-- Not applied in this change.
--
-- One frozen JSON payload per report, written when that report is published.
-- A later publish replaces the payload. Drafts do not read this table.
-- Every row carries organization_id and client_id. Members of an organization
-- can read and write their own rows through the user client and RLS.
-- anon has no grants. service_role can read (the client portal loads a shared
-- report server-side) and cannot insert, update, or delete.
-- No seed and no backfill. Search Console facts stay in gsc_history_facts.

create table if not exists public.report_tracking_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  report_id uuid not null references public.reports(id) on delete cascade,
  payload jsonb not null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint report_tracking_snapshots_payload_object check (
    jsonb_typeof(payload) = 'object'
    and payload ? 'schemaVersion'
  ),
  unique (report_id),
  unique (id, organization_id, client_id)
);

create index if not exists report_tracking_snapshots_client_idx
  on public.report_tracking_snapshots (organization_id, client_id);

comment on table public.report_tracking_snapshots is
  'Frozen tracked-keyword Search Console block for a published report. Replaced on the next publish. Not a live query.';

create or replace function public.guard_report_tracking_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.report_id is distinct from old.report_id
  ) then
    raise exception 'report tracking snapshots stay on their report' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.clients
    where id = new.client_id and organization_id = new.organization_id
  ) then
    raise exception 'Client does not belong to this organization' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.reports
    where id = new.report_id
      and organization_id = new.organization_id
      and client_id = new.client_id
  ) then
    raise exception 'Report does not belong to this client' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_report_tracking_snapshot() from public, anon;
grant execute on function public.guard_report_tracking_snapshot() to authenticated, service_role;

drop trigger if exists report_tracking_snapshots_scope on public.report_tracking_snapshots;
create trigger report_tracking_snapshots_scope
  before insert or update on public.report_tracking_snapshots
  for each row execute function public.guard_report_tracking_snapshot();

alter table public.report_tracking_snapshots enable row level security;

drop policy if exists report_tracking_snapshots_org on public.report_tracking_snapshots;
create policy report_tracking_snapshots_org on public.report_tracking_snapshots
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

revoke all on public.report_tracking_snapshots from public, anon, authenticated, service_role;
grant select, insert, update on public.report_tracking_snapshots to authenticated;
grant select on public.report_tracking_snapshots to service_role;
