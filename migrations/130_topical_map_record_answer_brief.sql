-- 130_topical_map_record_answer_brief.sql
-- Answer-ready brief on topical map records.
--
-- NOT APPLIED. Do not run this against any Supabase project.
-- The owner reviews and applies it separately.
--
-- One nullable jsonb column. No default. No backfill. Existing rows stay null.
-- Row level security is unchanged.
--
-- The 40-60 word direct answer reuses answer_first_60 from 083. This column
-- holds the rest of the brief the generator writes:
--   {"ai_prompts": [...], "headings": [...], "schema_type": "Service",
--    "price_table": false, "answer_trimmed": false}
-- schema_type and price_table are derived in code from the page type and
-- refined by the model. The app validates the shape before it writes.
--
-- Before this is applied, the generator saves each idea without the brief
-- (it retries the insert without this column) and the app shows no brief.
--
-- Rollback:
-- alter table public.topical_map_records
--   drop constraint if exists topical_map_records_answer_brief_check;
-- alter table public.topical_map_records
--   drop column if exists answer_brief;

alter table public.topical_map_records add column if not exists answer_brief jsonb;

alter table public.topical_map_records drop constraint if exists topical_map_records_answer_brief_check;
alter table public.topical_map_records
    add constraint topical_map_records_answer_brief_check
    check (
        answer_brief is null
        or (jsonb_typeof(answer_brief) = 'object' and pg_column_size(answer_brief) <= 8192)
    );

comment on column public.topical_map_records.answer_brief is
    'Answer-ready brief from the generator: ai_prompts, headings, schema_type, price_table, answer_trimmed. Null on rows created before this column existed and on manual adds. The direct answer is answer_first_60.';
