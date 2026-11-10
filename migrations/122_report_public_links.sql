-- 122: no-login public links for a frozen GTM Event Report.
--
-- The raw token is never stored. token_hash is sha-256, same as content
-- review links. The snapshot is the client report copied from the approved
-- report version. Revoke by setting revoked_at. anon has no grants.

create table if not exists public.report_public_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  report_id uuid not null references public.reports(id) on delete cascade,
  version_id uuid references public.report_versions(id) on delete set null,
  token_hash text not null check (length(token_hash) = 64),
  snapshot jsonb not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint report_public_links_token_unique unique (token_hash),
  constraint report_public_links_snapshot_object check (
    jsonb_typeof(snapshot) = 'object'
    and pg_column_size(snapshot) <= 524288
  )
);

create index if not exists report_public_links_report_idx
  on public.report_public_links (organization_id, report_id, created_at desc);

alter table public.report_public_links enable row level security;

drop policy if exists report_public_links_org on public.report_public_links;
create policy report_public_links_org on public.report_public_links
  for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

revoke all on public.report_public_links from public, anon, authenticated;
grant select on public.report_public_links to authenticated;
grant all on public.report_public_links to service_role;

comment on table public.report_public_links is
  'Unguessable, revocable, read-only links to a frozen GTM Event Report. The raw token is not stored.';
