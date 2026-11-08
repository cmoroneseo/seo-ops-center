-- Migration 118: campaign initiative roadmap story (phase, category, target month).
--
-- NOT APPLIED. Do not run this against the production Supabase project
-- (sgszojorcftyaknruckh). The owner reviews and applies it separately.
-- Not applied in this change.
--
-- Three nullable columns on campaign_initiatives. Null means not set.
-- Phase is the client-facing Roadmap set: Foundation, Growth, Scale.
-- Category is the Lists tab "Roadmap Category" set, in that order.
-- Target month is Month 1 through Month 12, counted from the engagement.
-- It does not replace starts_on or ends_on.
-- No progress column is added. No seed and no backfill.
-- Example template rows are not imported. Strategy plans, keyword lists,
-- tasks, and the deliverable product are not altered.

alter table public.campaign_initiatives
  add column if not exists phase text,
  add column if not exists category text,
  add column if not exists target_month text;

alter table public.campaign_initiatives
  drop constraint if exists campaign_initiatives_phase_check;
alter table public.campaign_initiatives
  add constraint campaign_initiatives_phase_check
  check (phase is null or phase in (
    'Phase 1: Foundation',
    'Phase 2: Growth',
    'Phase 3: Scale'
  ));

alter table public.campaign_initiatives
  drop constraint if exists campaign_initiatives_category_check;
alter table public.campaign_initiatives
  add constraint campaign_initiatives_category_check
  check (category is null or category in (
    'Technical',
    'On-Page',
    'Content',
    'Local SEO',
    'Link Building',
    'Analytics & Reporting'
  ));

alter table public.campaign_initiatives
  drop constraint if exists campaign_initiatives_target_month_check;
alter table public.campaign_initiatives
  add constraint campaign_initiatives_target_month_check
  check (target_month is null or target_month in (
    'Month 1',
    'Month 2',
    'Month 3',
    'Month 4',
    'Month 5',
    'Month 6',
    'Month 7',
    'Month 8',
    'Month 9',
    'Month 10',
    'Month 11',
    'Month 12'
  ));

comment on column public.campaign_initiatives.phase is
  'Client-facing roadmap phase. Null means not set. Not a progress percent.';
comment on column public.campaign_initiatives.category is
  'Roadmap category from the client-facing template Lists tab. Null means not set.';
comment on column public.campaign_initiatives.target_month is
  'Engagement-relative month label from Month 1 through Month 12. Null means not set. Does not replace starts_on or ends_on.';
