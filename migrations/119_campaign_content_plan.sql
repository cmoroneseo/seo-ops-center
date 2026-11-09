-- Migration 119: Campaign Work content plan.
--
-- NOT APPLIED. Do not run this against the production Supabase project
-- (sgszojorcftyaknruckh). The owner reviews and applies it separately.
-- Not applied in this change.
--
-- One client-scoped table for the Content Plan on Campaign Work.
-- The monthly pillar/stage board is a different store and is not copied here.
-- Roadmap initiatives are not changed. No seed and no backfill.
--
-- plan_month is the work calendar month (YYYY-MM). It is not an engagement
-- month. published_on and due_on are calendar dates. Neither is derived from
-- plan_month, and neither is an engagement month.
-- Status and content type are nullable slugs. Null means not set.
-- search_volume and keyword_difficulty are nullable integers with no default.
-- Null means not set. It is not zero, and these numbers are not fetched.
-- Published is a content status. It does not mean indexed or performing.
-- Title is required. Every other content column is nullable and has no default.

create or replace function public.guard_campaign_content_plan_scope()
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
    or new.plan_month is distinct from old.plan_month
  ) then
    raise exception 'content plan rows stay on their client and work month' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.touch_campaign_content_plan_row()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.guard_campaign_content_plan_scope() from public, anon;
revoke all on function public.touch_campaign_content_plan_row() from public, anon;
grant execute on function public.guard_campaign_content_plan_scope() to authenticated, service_role;
grant execute on function public.touch_campaign_content_plan_row() to authenticated, service_role;

create table if not exists public.campaign_content_plan (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  plan_month text not null check (plan_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  published_on date,
  status text,
  content_type text,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  keyword text,
  search_volume integer,
  keyword_difficulty integer,
  due_on date,
  draft_url text,
  live_url text,
  matching_product text,
  internal_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_content_plan_status_check check (status is null or status in (
    'idea',
    'keyword_approved',
    'in_progress',
    'in_review',
    'client_review',
    'approved',
    'published'
  )),
  constraint campaign_content_plan_content_type_check check (content_type is null or content_type in (
    'blog_post',
    'service_page',
    'location_page',
    'landing_page',
    'pillar_page',
    'product_page',
    'faq_page',
    'case_study'
  )),
  constraint campaign_content_plan_keyword_check check (
    keyword is null or char_length(btrim(keyword)) between 1 and 180
  ),
  constraint campaign_content_plan_search_volume_check check (
    search_volume is null or search_volume >= 0
  ),
  constraint campaign_content_plan_keyword_difficulty_check check (
    keyword_difficulty is null or keyword_difficulty between 0 and 100
  ),
  constraint campaign_content_plan_matching_product_check check (
    matching_product is null or char_length(btrim(matching_product)) between 1 and 180
  ),
  constraint campaign_content_plan_draft_url_check check (
    draft_url is null or (char_length(draft_url) between 1 and 500 and draft_url ~ '^https?://')
  ),
  constraint campaign_content_plan_live_url_check check (
    live_url is null or (char_length(live_url) between 1 and 500 and live_url ~ '^https?://')
  ),
  constraint campaign_content_plan_internal_url_check check (
    internal_url is null or (char_length(internal_url) between 1 and 500 and internal_url ~ '^https?://')
  )
);

create index if not exists campaign_content_plan_client_month_idx
  on public.campaign_content_plan (organization_id, client_id, plan_month, created_at);

comment on table public.campaign_content_plan is
  'Content Plan rows for one client and one work calendar month. No seed. Published is not indexed and not performing.';
comment on column public.campaign_content_plan.plan_month is
  'Work calendar month, YYYY-MM. Not an engagement month. No default.';
comment on column public.campaign_content_plan.published_on is
  'Calendar publish date. Null means not set. Not derived from plan_month or due_on.';
comment on column public.campaign_content_plan.due_on is
  'Calendar due date. Null means not set. Not derived from plan_month or published_on.';
comment on column public.campaign_content_plan.status is
  'Content status slug. Null means not set. published is not indexed and not performing.';
comment on column public.campaign_content_plan.content_type is
  'Content type slug. Null means not set.';
comment on column public.campaign_content_plan.keyword is
  'Target keyword text. Null means not set. Volume and difficulty are not fetched.';
comment on column public.campaign_content_plan.search_volume is
  'Optional stored volume. Null means not set. Not zero. No default.';
comment on column public.campaign_content_plan.keyword_difficulty is
  'Optional stored keyword difficulty from 0 to 100. Null means not set. Not zero. No default.';
comment on column public.campaign_content_plan.draft_url is
  'Optional http(s) draft link. Null means not set.';
comment on column public.campaign_content_plan.live_url is
  'Optional http(s) live link. Null means not set. Not required when status is published.';
comment on column public.campaign_content_plan.internal_url is
  'Optional http(s) internal link. Null means not set.';
comment on column public.campaign_content_plan.matching_product is
  'Optional product or service label. Null means not set.';

drop trigger if exists campaign_content_plan_scope on public.campaign_content_plan;
create trigger campaign_content_plan_scope
  before insert or update on public.campaign_content_plan
  for each row execute function public.guard_campaign_content_plan_scope();

drop trigger if exists campaign_content_plan_touch on public.campaign_content_plan;
create trigger campaign_content_plan_touch
  before update on public.campaign_content_plan
  for each row execute function public.touch_campaign_content_plan_row();

alter table public.campaign_content_plan enable row level security;

drop policy if exists campaign_content_plan_org on public.campaign_content_plan;
create policy campaign_content_plan_org on public.campaign_content_plan
  for all to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

revoke all on public.campaign_content_plan from public, anon, authenticated;
grant select, insert, update, delete on public.campaign_content_plan to authenticated;
grant all on public.campaign_content_plan to service_role;
