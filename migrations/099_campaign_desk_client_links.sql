-- 099: Campaign Desk client map. Not applied in this change.
--
-- Apply after 098. This migration creates one new table, one index, and a
-- read policy. It does not alter clients, time_logs, tasks, planner_events,
-- campaign_desk_sync_runs, or any existing row, and it does not lock those
-- tables.
--
-- The map is an SEO Ops client id to a Campaign Desk client id. Owners and
-- admins can read it. Inserts and updates happen only through the service
-- role, after the API route has checked the caller is an owner or admin.
-- Version 2 sync reads it when CAMPAIGN_DESK_SYNC_V2 is exactly true. Leave
-- that flag off until this table exists. Version 1 does not read this table.
--
-- There is no cron. A browser session cannot insert or update this table.

create table public.campaign_desk_client_links (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  campaign_desk_client_id text not null,
  matched_by text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  primary key (organization_id, client_id),
  check (matched_by in ('name', 'manual')),
  check (campaign_desk_client_id = btrim(campaign_desk_client_id)),
  check (length(campaign_desk_client_id) between 1 and 64)
);

create index campaign_desk_client_links_org_idx
  on public.campaign_desk_client_links (organization_id);

alter table public.campaign_desk_client_links enable row level security;

-- Owners and admins can read the map for their own organization.
create policy "Managers can read campaign desk client links"
  on public.campaign_desk_client_links for select
  using (
    organization_id in (select public.get_user_org_ids())
    and exists (
      select 1
      from public.organization_members member
      where member.organization_id = campaign_desk_client_links.organization_id
        and member.user_id = auth.uid()
        and member.role in ('owner', 'admin')
    )
  );

revoke all on table public.campaign_desk_client_links from public, anon, authenticated;
grant select on table public.campaign_desk_client_links to authenticated;
grant select, insert, update, delete on table public.campaign_desk_client_links to service_role;
