-- Migration 129: group tests on the SEO change log.
--
-- NOT APPLIED. Do not run this against the production Supabase project
-- (sgszojorcftyaknruckh) or any other live database.
-- The owner reviews and applies it separately.
-- Not applied in this change.
--
-- Adds two columns to seo_changes:
--   test_kind   single (one change) or group (the same treatment on many URLs,
--               measured together over time). A split test is not a value yet.
--   treatment   template slug for a group. Empty on a single change.
--
-- Existing rows stay single with an empty treatment, via the column defaults.
-- This file does not insert rows, does not start a sync, and does not call an API.
--
-- Rollback:
-- alter table public.seo_changes drop constraint if exists seo_changes_group_treatment_check;
-- alter table public.seo_changes drop constraint if exists seo_changes_treatment_check;
-- alter table public.seo_changes drop constraint if exists seo_changes_test_kind_check;
-- alter table public.seo_changes drop column if exists treatment;
-- alter table public.seo_changes drop column if exists test_kind;

alter table public.seo_changes
  add column if not exists test_kind text not null default 'single';

alter table public.seo_changes
  add column if not exists treatment text not null default '';

alter table public.seo_changes
  drop constraint if exists seo_changes_test_kind_check;

alter table public.seo_changes
  add constraint seo_changes_test_kind_check
  check (test_kind in ('single', 'group'));

alter table public.seo_changes
  drop constraint if exists seo_changes_treatment_check;

alter table public.seo_changes
  add constraint seo_changes_treatment_check
  check (treatment in ('', 'title_meta', 'title', 'meta', 'h1', 'other'));

alter table public.seo_changes
  drop constraint if exists seo_changes_group_treatment_check;

alter table public.seo_changes
  add constraint seo_changes_group_treatment_check
  check (
    (test_kind = 'single' and treatment = '')
    or (test_kind = 'group' and treatment <> '')
  );

comment on column public.seo_changes.test_kind is
  'single is one change. group is the same treatment on many URLs, measured together over time. A split test is not a value yet.';

comment on column public.seo_changes.treatment is
  'Group-test template: title_meta, title, meta, h1, or other. Empty on a single change.';
