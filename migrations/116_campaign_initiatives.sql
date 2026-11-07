-- Migration 116: campaign initiatives (Campaign roadmap slice).
--
-- NOT APPLIED. Do not run this against the production Supabase project
-- (sgszojorcftyaknruckh). The owner reviews and applies it separately.
-- Not applied in this change.
--
-- Two client-scoped tables. Every row carries organization_id and client_id.
-- Members of an organization can read and write their own rows through the
-- user client and RLS, the same way they manage keyword lists. anon has no
-- grants. No seed and no backfill. Strategy plans, keyword lists, tasks, and
-- the deliverable product are not altered.
--
-- campaign_initiative_items is a checklist on an initiative (draft, review,
-- approved, published). It is not a task and not a deliverable commitment.
-- Published requires a live http(s) URL and a publish date.
-- Completed & Verified requires an evidence http(s) URL and a verification
-- date. Stale evidence is derived from that date in the app; it is not a
-- stored state that can be painted green.

create or replace function public.guard_campaign_initiative_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.clients
    where id = new.client_id and organization_id = new.organization_id
  ) then
    raise exception 'Client does not belong to this organization' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.client_id is distinct from old.client_id
  ) then
    raise exception 'campaign initiative rows stay on their client' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_campaign_initiative_item_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.clients
    where id = new.client_id and organization_id = new.organization_id
  ) then
    raise exception 'Client does not belong to this organization' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.client_id is distinct from old.client_id
    or new.initiative_id is distinct from old.initiative_id
  ) then
    raise exception 'checklist rows stay on their initiative' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.touch_campaign_initiative_row()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.guard_campaign_initiative_scope() from public, anon;
revoke all on function public.guard_campaign_initiative_item_scope() from public, anon;
revoke all on function public.touch_campaign_initiative_row() from public, anon;
grant execute on function public.guard_campaign_initiative_scope() to authenticated, service_role;
grant execute on function public.guard_campaign_initiative_item_scope() to authenticated, service_role;
grant execute on function public.touch_campaign_initiative_row() to authenticated, service_role;

create table if not exists public.campaign_initiatives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  purpose text check (purpose is null or char_length(purpose) between 1 and 600),
  owner_name text check (owner_name is null or char_length(owner_name) between 1 and 120),
  priority smallint not null default 2 check (priority between 1 and 4),
  state text not null check (state in (
    'planned',
    'in_progress',
    'awaiting_approval',
    'blocked',
    'on_hold',
    'completed_verified'
  )),
  starts_on date,
  ends_on date,
  page_url text check (
    page_url is null or (char_length(page_url) between 1 and 500 and page_url ~ '^https?://')
  ),
  success_metric_label text check (
    success_metric_label is null or char_length(success_metric_label) between 1 and 160
  ),
  evidence_url text check (
    evidence_url is null or (char_length(evidence_url) between 1 and 500 and evidence_url ~ '^https?://')
  ),
  verified_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (
    state <> 'completed_verified'
    or (evidence_url is not null and verified_on is not null)
  ),
  unique (id, organization_id, client_id)
);

create index if not exists campaign_initiatives_client_idx
  on public.campaign_initiatives (organization_id, client_id, priority, title);

comment on table public.campaign_initiatives is
  'Campaign roadmap work for one client. Evidence freshness is not stored. No backfill.';
comment on column public.campaign_initiatives.success_metric_label is
  'A name for the metric this work cares about. Not a measured number.';
comment on column public.campaign_initiatives.verified_on is
  'The date evidence was verified. The app labels the row stale after 60 days.';

create table if not exists public.campaign_initiative_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  initiative_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  content_state text not null check (content_state in ('draft', 'review', 'approved', 'published')),
  draft_url text check (
    draft_url is null or (char_length(draft_url) between 1 and 500 and draft_url ~ '^https?://')
  ),
  live_url text check (
    live_url is null or (char_length(live_url) between 1 and 500 and live_url ~ '^https?://')
  ),
  published_on date,
  position integer not null default 0 check (position >= 0 and position < 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    content_state <> 'published'
    or (live_url is not null and published_on is not null)
  ),
  foreign key (initiative_id, organization_id, client_id)
    references public.campaign_initiatives (id, organization_id, client_id) on delete cascade
);

create index if not exists campaign_initiative_items_parent_idx
  on public.campaign_initiative_items (initiative_id, position);

comment on table public.campaign_initiative_items is
  'Checklist on a campaign initiative. Published requires a live URL and a publish date.';

drop trigger if exists campaign_initiatives_scope on public.campaign_initiatives;
create trigger campaign_initiatives_scope
  before insert or update on public.campaign_initiatives
  for each row execute function public.guard_campaign_initiative_scope();

drop trigger if exists campaign_initiatives_touch on public.campaign_initiatives;
create trigger campaign_initiatives_touch
  before update on public.campaign_initiatives
  for each row execute function public.touch_campaign_initiative_row();

drop trigger if exists campaign_initiative_items_scope on public.campaign_initiative_items;
create trigger campaign_initiative_items_scope
  before insert or update on public.campaign_initiative_items
  for each row execute function public.guard_campaign_initiative_item_scope();

drop trigger if exists campaign_initiative_items_touch on public.campaign_initiative_items;
create trigger campaign_initiative_items_touch
  before update on public.campaign_initiative_items
  for each row execute function public.touch_campaign_initiative_row();

alter table public.campaign_initiatives enable row level security;
alter table public.campaign_initiative_items enable row level security;

drop policy if exists campaign_initiatives_org on public.campaign_initiatives;
create policy campaign_initiatives_org on public.campaign_initiatives
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

drop policy if exists campaign_initiative_items_org on public.campaign_initiative_items;
create policy campaign_initiative_items_org on public.campaign_initiative_items
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

revoke all on public.campaign_initiatives, public.campaign_initiative_items from public, anon, authenticated;
grant select, insert, update on public.campaign_initiatives to authenticated;
grant select, insert, update, delete on public.campaign_initiative_items to authenticated;
grant all on public.campaign_initiatives, public.campaign_initiative_items to service_role;
