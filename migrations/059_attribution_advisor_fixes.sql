-- 059 attribution advisor fixes
-- Keep the canary allowlist readable only within a member's own organization
-- without exposing an authenticated SECURITY DEFINER RPC.

grant select on table public.attribution_enabled_organizations to authenticated;
create policy "Org members can read attribution rollout"
  on public.attribution_enabled_organizations for select
  using (organization_id in (select get_user_org_ids()));

drop policy "Enabled org members can manage attribution_sites" on public.attribution_sites;
create policy "Enabled org members can manage attribution_sites"
  on public.attribution_sites for all
  using (
    organization_id in (select get_user_org_ids())
    and exists (
      select 1 from public.attribution_enabled_organizations enabled
      where enabled.organization_id = attribution_sites.organization_id
    )
  )
  with check (
    organization_id in (select get_user_org_ids())
    and exists (
      select 1 from public.attribution_enabled_organizations enabled
      where enabled.organization_id = attribution_sites.organization_id
    )
  );

revoke all on function public.is_attribution_enabled(uuid) from authenticated, service_role;
drop function public.is_attribution_enabled(uuid);

create index attribution_sites_client_org_fk_idx
  on public.attribution_sites(client_id, organization_id);
create index attribution_events_site_org_fk_idx
  on public.attribution_events(site_id, organization_id);
create index attribution_conversions_site_org_client_fk_idx
  on public.attribution_conversions(site_id, organization_id, client_id);
create index attribution_conversions_event_site_org_fk_idx
  on public.attribution_conversions(event_id, site_id, organization_id);
