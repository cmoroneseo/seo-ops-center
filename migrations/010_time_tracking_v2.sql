-- Migration 010: Time Tracking V2
-- Adds status, timer_started_at, category, and elapsed_seconds to time_logs
-- to support the global persistent timer chip.

ALTER TABLE time_logs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'logged'
    CHECK (status IN ('in_progress', 'logged', 'needs_review')),
  ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS elapsed_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS category TEXT;

-- Index for fast lookup of in-progress entries per user
CREATE INDEX IF NOT EXISTS idx_time_logs_in_progress
  ON time_logs (organization_id, user_id, status)
  WHERE status = 'in_progress';

-- Backfill: all existing rows are already "logged"
UPDATE time_logs SET status = 'logged' WHERE status IS NULL;
