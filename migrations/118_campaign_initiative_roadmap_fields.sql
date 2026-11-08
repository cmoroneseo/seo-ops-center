-- Migration 118: campaign initiative roadmap story (phase, category, target month).
--
-- NOT APPLIED. Do not run this against the production Supabase project
-- (sgszojorcftyaknruckh). The owner reviews and applies it separately.
-- Not applied in this change.
--
-- Three nullable columns on campaign_initiatives. No default. Null means
-- not set. No backfill.
-- Phase slugs: foundation, growth, scale.
-- Category slugs match the Lists tab Roadmap Category values:
-- technical, on_page, content, local_seo, link_building, analytics_reporting.
-- target_month is an integer 1 through 12, counted from the engagement.
-- It does not replace starts_on or ends_on, and it is not a calendar month.
-- No progress column is added. No seed.
-- Example template rows are not imported. Strategy plans, keyword lists,
-- tasks, and the deliverable product are not altered.

alter table public.campaign_initiatives
  add column if not exists phase text,
  add column if not exists category text,
  add column if not exists target_month smallint;

alter table public.campaign_initiatives
  drop constraint if exists campaign_initiatives_phase_check;
alter table public.campaign_initiatives
  add constraint campaign_initiatives_phase_check
  check (phase is null or phase in ('foundation', 'growth', 'scale'));

alter table public.campaign_initiatives
  drop constraint if exists campaign_initiatives_category_check;
alter table public.campaign_initiatives
  add constraint campaign_initiatives_category_check
  check (category is null or category in (
    'technical',
    'on_page',
    'content',
    'local_seo',
    'link_building',
    'analytics_reporting'
  ));

alter table public.campaign_initiatives
  drop constraint if exists campaign_initiatives_target_month_check;
alter table public.campaign_initiatives
  add constraint campaign_initiatives_target_month_check
  check (target_month is null or target_month between 1 and 12);

comment on column public.campaign_initiatives.phase is
  'Roadmap phase slug: foundation, growth, or scale. Null means not set.';
comment on column public.campaign_initiatives.category is
  'Roadmap category slug from the client-facing template Lists tab. Null means not set.';
comment on column public.campaign_initiatives.target_month is
  'Engagement-relative month, 1 through 12. Null means not set. Does not replace starts_on or ends_on.';
