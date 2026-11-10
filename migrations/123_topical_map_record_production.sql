-- 123_topical_map_record_production.sql
-- Production lifecycle on topical map records.
--
-- NOT APPLIED. Do not run this against any Supabase project.
-- The owner reviews and applies it separately.
--
-- Nullable columns only. No default. No backfill. Existing rows stay null.
-- The plan-approval status column is unchanged.
-- Row level security is unchanged.
--
-- production_status is the content lifecycle, separate from plan approval.
-- work_month is a calendar month, YYYY-MM. It does not fill due_date or published_on.
-- due_date and published_on are calendar dates. Neither is derived from the other
-- or from work_month.
-- draft_url and live_url are optional http(s) links.
-- content_type is an optional page kind. Null means not chosen.
-- Published is a content status. It does not mean indexed or performing.
--
-- Rollback:
-- alter table public.topical_map_records
--   drop constraint if exists topical_map_records_production_status_check,
--   drop constraint if exists topical_map_records_work_month_check,
--   drop constraint if exists topical_map_records_draft_url_check,
--   drop constraint if exists topical_map_records_live_url_check,
--   drop constraint if exists topical_map_records_content_type_check;
-- alter table public.topical_map_records
--   drop column if exists production_status,
--   drop column if exists work_month,
--   drop column if exists due_date,
--   drop column if exists published_on,
--   drop column if exists draft_url,
--   drop column if exists live_url,
--   drop column if exists content_type;

alter table public.topical_map_records add column if not exists production_status text;
alter table public.topical_map_records add column if not exists work_month text;
alter table public.topical_map_records add column if not exists due_date date;
alter table public.topical_map_records add column if not exists published_on date;
alter table public.topical_map_records add column if not exists draft_url text;
alter table public.topical_map_records add column if not exists live_url text;
alter table public.topical_map_records add column if not exists content_type text;

alter table public.topical_map_records drop constraint if exists topical_map_records_production_status_check;
alter table public.topical_map_records
    add constraint topical_map_records_production_status_check
    check (production_status is null or production_status in (
        'not_written',
        'awaiting_approval',
        'approved',
        'writing',
        'client_review',
        'ready',
        'published',
        'already_live',
        'declined',
        'failed'
    ));

alter table public.topical_map_records drop constraint if exists topical_map_records_work_month_check;
alter table public.topical_map_records
    add constraint topical_map_records_work_month_check
    check (work_month is null or work_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

alter table public.topical_map_records drop constraint if exists topical_map_records_draft_url_check;
alter table public.topical_map_records
    add constraint topical_map_records_draft_url_check
    check (
        draft_url is null
        or (char_length(draft_url) between 1 and 500 and draft_url ~ '^https?://')
    );

alter table public.topical_map_records drop constraint if exists topical_map_records_live_url_check;
alter table public.topical_map_records
    add constraint topical_map_records_live_url_check
    check (
        live_url is null
        or (char_length(live_url) between 1 and 500 and live_url ~ '^https?://')
    );

alter table public.topical_map_records drop constraint if exists topical_map_records_content_type_check;
alter table public.topical_map_records
    add constraint topical_map_records_content_type_check
    check (content_type is null or content_type in (
        'blog_post',
        'service_page',
        'location_page',
        'landing_page',
        'pillar_page',
        'product_page',
        'faq_page',
        'case_study'
    ));

comment on column public.topical_map_records.production_status is
    'Content lifecycle slug. Null means not set. Separate from plan approval. No default. published is not indexed and not performing.';
comment on column public.topical_map_records.work_month is
    'Calendar month the page is planned for, YYYY-MM. Null means not set. Not an engagement month. Does not fill due_date or published_on.';
comment on column public.topical_map_records.due_date is
    'Calendar due date. Null means not set. Not derived from work_month or published_on.';
comment on column public.topical_map_records.published_on is
    'Calendar date the page was published. Null means not set. Not derived from work_month or due_date. Not indexed and not performing.';
comment on column public.topical_map_records.draft_url is
    'Optional http(s) draft link. Null means not set.';
comment on column public.topical_map_records.live_url is
    'Optional http(s) live link. Null means not set. Not required when the status is published.';
comment on column public.topical_map_records.content_type is
    'Optional page kind. Null means not chosen.';
