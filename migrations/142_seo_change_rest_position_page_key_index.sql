-- Migration 142: Page-only day lookup for seo_change_rest_position.
-- NOT APPLIED — needs owner approval.
-- Run as one standalone SQL statement outside a transaction. Supabase's
-- migration runner wraps migration files in a transaction.
-- The concurrent build allows reads and writes. A failed build can leave an
-- INVALID index. Check pg_index.indisvalid and, if false, run the following
-- standalone statement before retrying:
-- drop index concurrently if exists public.gsc_history_facts_page_key_day_idx;

create index concurrently if not exists gsc_history_facts_page_key_day_idx
  on public.gsc_history_facts (day_id) where grain = 'page';
