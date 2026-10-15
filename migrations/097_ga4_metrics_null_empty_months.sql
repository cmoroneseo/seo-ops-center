-- 097: Null out fake GA4 zeros on closed months that had no report rows.
-- Not applied in this change. Apply only after 096, and only after the
-- count-preview query below has been read. This file changes existing
-- metrics rows only. It does not change GSC, GBP, Ahrefs, or manual rows.
--
-- Why these rows exist: lib/sync/fetchGA4.ts used to return
--   { sessions: 0, new_users: 0, organic_sessions: 0, bounce_rate: null }
-- when a closed month's GA4 report had no rows. That is not a measured zero.
-- A month that had sessions and an empty organic report is a different object
-- (sessions > 0, organic_sessions: 0) and is left alone. So is a real zero
-- that arrived with any other key, a non-null bounce rate, provenance, a
-- manual source_type, or a month that is still open in Pacific time.
--
-- Exact WHERE (all of these):
--   source = 'ga4'
--   source_type = 'auto'
--   provenance is null
--   metric_month matches YYYY-MM
--   metric_month is strictly before the current America/Los_Angeles month
--   data equals this jsonb object, no extra keys, numeric zeros, bounce null:
--     {"sessions":0,"new_users":0,"organic_sessions":0,"bounce_rate":null}
-- jsonb equality ignores key order. A string "0" does not match a number 0.
--
-- Count preview (run this first; do not treat it as the update):
--
--   select count(*) as rows_to_null
--   from public.metrics
--   where source = 'ga4'
--     and source_type = 'auto'
--     and provenance is null
--     and metric_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
--     and metric_month < to_char((now() at time zone 'America/Los_Angeles'), 'YYYY-MM')
--     and data = '{"bounce_rate":null,"new_users":0,"organic_sessions":0,"sessions":0}'::jsonb;
--
-- Left alone on purpose (organic zero with real sessions):
--
--   select count(*) as organic_zeros_kept
--   from public.metrics
--   where source = 'ga4'
--     and source_type = 'auto'
--     and coalesce((data ->> 'sessions')::numeric, -1) > 0
--     and data ->> 'organic_sessions' = '0';
--
-- The update is idempotent. After it runs, the same preview returns 0.

update public.metrics
set data = '{"bounce_rate":null,"new_users":null,"organic_sessions":null,"sessions":null}'::jsonb,
    updated_at = now()
where source = 'ga4'
  and source_type = 'auto'
  and provenance is null
  and metric_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
  and metric_month < to_char((now() at time zone 'America/Los_Angeles'), 'YYYY-MM')
  and data = '{"bounce_rate":null,"new_users":0,"organic_sessions":0,"sessions":0}'::jsonb;
