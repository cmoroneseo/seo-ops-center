-- Migration 114: one running timer per bot key.
--
-- NOT APPLIED. Do not run this against the production Supabase project
-- (sgszojorcftyaknruckh). The owner reviews and applies it separately.
-- Not applied in this change.
--
-- Depends on migration 113 (time_logs.bot_key_id), which is already present
-- in production. This file does not rewrite 113.
--
-- A bot timer is an in_progress time_log attributed to the owner and stamped
-- with bot_key_id. It does not insert an open time_log_segments row. The human
-- timer's one_open_time_segment_per_user index is one open segment per user,
-- and every bot is attributed to that same user, so an open bot segment would
-- block the owner's timer and every other bot.
--
-- This index is the concurrency lock the start route cannot take by itself.
-- Two starts for one bot cannot both insert an in_progress row. Human timers
-- leave bot_key_id null, so they are outside the index.
--
-- A timer that runs past two hours is stopped with the existing
-- time_logs.status value 'needs_review' (migration 010). No new column.
--
-- Locks: CREATE INDEX CONCURRENTLY cannot run inside the migration transaction
-- Supabase applies. The plain unique index locks writes to time_logs only for
-- the build. It does not rewrite the table and it does not update any row.
--
-- Rollback: drop index if exists public.time_logs_one_running_bot_timer;

create unique index if not exists time_logs_one_running_bot_timer
  on public.time_logs (bot_key_id)
  where status = 'in_progress' and bot_key_id is not null;
