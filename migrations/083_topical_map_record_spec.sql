-- 083: page spec fields on topical map records.
-- 082 is the content-writer LLM ledger. 083 was free on main when this shipped.
--
-- Nullable columns only. Existing rows stay null, so approve and decline
-- keep working before anyone fills in a spec.
-- source is generated | manual | crawl | gsc.
-- spec_status is draft | ready.
-- answer_first_60 is at most 60 words. The app validates the same limit.
--
-- Apply this file in the Supabase SQL editor before turning on
-- CONTENT_WRITER_SPEC_ENABLED. This migration is not applied by the app.
--
-- Rollback:
-- alter table public.topical_map_records
--   drop constraint if exists topical_map_records_answer_first_60_check,
--   drop constraint if exists topical_map_records_unique_angle_check,
--   drop constraint if exists topical_map_records_spec_status_check,
--   drop constraint if exists topical_map_records_source_check;
-- alter table public.topical_map_records
--   drop column if exists answer_first_60,
--   drop column if exists unique_angle,
--   drop column if exists scheduled_for,
--   drop column if exists spec_status,
--   drop column if exists source;

alter table public.topical_map_records add column if not exists answer_first_60 text;
alter table public.topical_map_records add column if not exists unique_angle text;
alter table public.topical_map_records add column if not exists scheduled_for date;
alter table public.topical_map_records add column if not exists spec_status text;
alter table public.topical_map_records add column if not exists source text;

alter table public.topical_map_records drop constraint if exists topical_map_records_answer_first_60_check;
alter table public.topical_map_records
    add constraint topical_map_records_answer_first_60_check
    check (
        answer_first_60 is null
        or (
            char_length(answer_first_60) <= 2000
            and (
                btrim(answer_first_60) = ''
                or cardinality(regexp_split_to_array(btrim(answer_first_60), '\s+')) <= 60
            )
        )
    );

alter table public.topical_map_records drop constraint if exists topical_map_records_unique_angle_check;
alter table public.topical_map_records
    add constraint topical_map_records_unique_angle_check
    check (unique_angle is null or char_length(unique_angle) <= 4000);

alter table public.topical_map_records drop constraint if exists topical_map_records_spec_status_check;
alter table public.topical_map_records
    add constraint topical_map_records_spec_status_check
    check (spec_status is null or spec_status in ('draft', 'ready'));

alter table public.topical_map_records drop constraint if exists topical_map_records_source_check;
alter table public.topical_map_records
    add constraint topical_map_records_source_check
    check (source is null or source in ('generated', 'manual', 'crawl', 'gsc'));

comment on column public.topical_map_records.answer_first_60 is
    'The answer a writer should land in the first 60 words. Null until an AM writes it. At most 60 words.';
comment on column public.topical_map_records.unique_angle is
    'What this page covers that the rest of the map does not. Null until an AM writes it.';
comment on column public.topical_map_records.scheduled_for is
    'The date the AM plans to produce this page. Null until scheduled. A date, not a timestamp.';
comment on column public.topical_map_records.spec_status is
    'draft or ready. Null means the spec has not been started. Separate from the record approval status.';
comment on column public.topical_map_records.source is
    'generated, manual, crawl, or gsc. Null on rows created before this column existed. Manual adds set manual.';
