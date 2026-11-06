-- Migration 115: keyword tracking lists (PR 1.2).
--
-- NOT APPLIED. Do not run this against the production Supabase project
-- (sgszojorcftyaknruckh). The owner reviews and applies it separately.
-- Not applied in this change.
--
-- Four client-scoped tables. Every row carries organization_id and client_id.
-- Members of an organization can read and write their own rows, the same way
-- they manage marketing plans and content approvals. anon has no grants.
-- Sync tables (GSC, GA4, Bing) stay service-role writes; these rows are
-- staff-authored, so the browser role is allowed to write them.
--
-- tracking_targets is engine x device x location x language. A geo change
-- inserts a new row and sets retired_at on the old one. Members cannot
-- delete a target. Deleting the client still cascades, as with other
-- client-scoped tables. service_role keeps DELETE for maintenance.
-- engine = 'gsc' is the v1 pseudo-target: all locations and devices, so
-- device, location_name, and language_code stay null. One live gsc row
-- per client.
--
-- TODO(PR 1.3): Seed that gsc row the first time a keyword is tracked for
-- the client. Label it "GSC (all locations/devices)". This repo has no
-- after-insert trigger on public.clients that seeds child rows, and this
-- migration does not add one. Existing clients are not backfilled.
--
-- tracked_keywords.source is paste, gsc_promote, ahrefs_import, or research.
-- Nothing in this migration calls an external provider. ahrefs_import is only
-- a stored label from the plan. The per-client cap (default 50, config) is
-- enforced when keywords are added in PR 1.3. It is not a check constraint,
-- so a later config change does not need a new migration.
--
-- client_brand_terms is the brand lexicon: brand, misspelling, owner, product.
-- tracking_notes holds manual notes plus automatic keywords_changed and
-- method_changed notes.
--
-- normalized_key matches lib/search-reporting/tracker.ts normalizeTrackerQuery
-- for ordinary keywords: trim ends, lowercase, collapse internal whitespace.
-- The column is generated, so a writer cannot store a second spelling of the
-- same key.

create or replace function public.normalize_tracker_query(value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when value is null then null
    else regexp_replace(
      lower(regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g')),
      '[[:space:]]+',
      ' ',
      'g'
    )
  end
$$;

revoke all on function public.normalize_tracker_query(text) from public, anon;
grant execute on function public.normalize_tracker_query(text) to authenticated, service_role;

create table if not exists public.tracking_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 160),
  engine text not null check (engine in ('gsc', 'google')),
  device text check (device is null or device in ('desktop', 'mobile')),
  location_name text check (location_name is null or char_length(btrim(location_name)) between 1 and 160),
  language_code text check (language_code is null or language_code ~ '^[a-z]{2}(-[a-z0-9]{2,8})?$'),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    engine <> 'gsc'
    or (device is null and location_name is null and language_code is null)
  ),
  unique (id, organization_id, client_id)
);

create unique index if not exists tracking_targets_one_live_gsc_idx
  on public.tracking_targets (client_id)
  where engine = 'gsc' and retired_at is null;

create unique index if not exists tracking_targets_live_dimensions_idx
  on public.tracking_targets (
    client_id,
    engine,
    coalesce(device, ''),
    coalesce(lower(btrim(location_name)), ''),
    coalesce(language_code, '')
  )
  where retired_at is null;

create index if not exists tracking_targets_client_idx
  on public.tracking_targets (organization_id, client_id);

comment on table public.tracking_targets is
  'Engine, device, location, and language for keyword tracking. Retire a row instead of deleting it. TODO(PR 1.3): seed one live gsc row, labeled GSC (all locations/devices), when the first keyword is tracked. This migration does not seed it.';

create table if not exists public.tracked_keywords (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  target_id uuid not null,
  keyword text not null check (
    char_length(keyword) between 1 and 500
    and char_length(public.normalize_tracker_query(keyword)) between 1 and 500
  ),
  normalized_key text generated always as (public.normalize_tracker_query(keyword)) stored,
  tags text[] not null default '{}',
  is_branded_override boolean,
  source text not null check (source in ('paste', 'gsc_promote', 'ahrefs_import', 'research')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(tags) <= 20),
  foreign key (target_id, organization_id, client_id)
    references public.tracking_targets (id, organization_id, client_id) on delete cascade,
  unique (target_id, normalized_key)
);

create index if not exists tracked_keywords_client_active_idx
  on public.tracked_keywords (organization_id, client_id)
  where active;

comment on column public.tracked_keywords.is_branded_override is
  'Null uses the brand lexicon. True or false is a manual override.';
comment on column public.tracked_keywords.source is
  'paste, gsc_promote, ahrefs_import, or research. No provider call writes this column in this migration.';

create table if not exists public.client_brand_terms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  term text not null check (
    char_length(term) between 1 and 120
    and char_length(public.normalize_tracker_query(term)) between 1 and 120
  ),
  normalized_key text generated always as (public.normalize_tracker_query(term)) stored,
  kind text not null check (kind in ('brand', 'misspelling', 'owner', 'product')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, normalized_key)
);

create index if not exists client_brand_terms_client_idx
  on public.client_brand_terms (organization_id, client_id);

create table if not exists public.tracking_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  target_id uuid,
  kind text not null check (kind in ('manual', 'keywords_changed', 'method_changed')),
  body text not null check (char_length(btrim(body)) between 1 and 8000),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (target_id, organization_id, client_id)
    references public.tracking_targets (id, organization_id, client_id) on delete cascade
);

create index if not exists tracking_notes_client_idx
  on public.tracking_notes (organization_id, client_id, created_at desc);

create index if not exists tracking_notes_target_idx
  on public.tracking_notes (target_id)
  where target_id is not null;

create or replace function public.guard_keyword_tracking_scope()
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
    raise exception 'keyword tracking rows stay on their client' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_tracking_target_dimensions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.engine is distinct from old.engine
    or new.device is distinct from old.device
    or new.location_name is distinct from old.location_name
    or new.language_code is distinct from old.language_code
  ) then
    raise exception 'tracking target dimensions are fixed; add a new target' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_keyword_tracking_scope() from public, anon;
revoke all on function public.guard_tracking_target_dimensions() from public, anon;
grant execute on function public.guard_keyword_tracking_scope() to authenticated, service_role;
grant execute on function public.guard_tracking_target_dimensions() to authenticated, service_role;

drop trigger if exists tracking_targets_scope on public.tracking_targets;
create trigger tracking_targets_scope
  before insert or update on public.tracking_targets
  for each row execute function public.guard_keyword_tracking_scope();

drop trigger if exists tracking_targets_dimensions on public.tracking_targets;
create trigger tracking_targets_dimensions
  before update on public.tracking_targets
  for each row execute function public.guard_tracking_target_dimensions();

drop trigger if exists tracked_keywords_scope on public.tracked_keywords;
create trigger tracked_keywords_scope
  before insert or update on public.tracked_keywords
  for each row execute function public.guard_keyword_tracking_scope();

drop trigger if exists client_brand_terms_scope on public.client_brand_terms;
create trigger client_brand_terms_scope
  before insert or update on public.client_brand_terms
  for each row execute function public.guard_keyword_tracking_scope();

drop trigger if exists tracking_notes_scope on public.tracking_notes;
create trigger tracking_notes_scope
  before insert or update on public.tracking_notes
  for each row execute function public.guard_keyword_tracking_scope();

alter table public.tracking_targets enable row level security;
alter table public.tracked_keywords enable row level security;
alter table public.client_brand_terms enable row level security;
alter table public.tracking_notes enable row level security;

drop policy if exists tracking_targets_org on public.tracking_targets;
create policy tracking_targets_org on public.tracking_targets
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

drop policy if exists tracked_keywords_org on public.tracked_keywords;
create policy tracked_keywords_org on public.tracked_keywords
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

drop policy if exists client_brand_terms_org on public.client_brand_terms;
create policy client_brand_terms_org on public.client_brand_terms
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

drop policy if exists tracking_notes_org on public.tracking_notes;
create policy tracking_notes_org on public.tracking_notes
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

revoke all on public.tracking_targets, public.tracked_keywords, public.client_brand_terms, public.tracking_notes
  from public, anon, authenticated;
grant select, insert, update on public.tracking_targets to authenticated;
grant select, insert, update, delete on public.tracked_keywords, public.client_brand_terms, public.tracking_notes to authenticated;
grant all on public.tracking_targets, public.tracked_keywords, public.client_brand_terms, public.tracking_notes to service_role;
