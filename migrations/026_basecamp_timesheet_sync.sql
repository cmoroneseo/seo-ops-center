-- 026: Basecamp timesheet sync
-- Links time_logs rows to Basecamp timesheet entries so time tracked in the app
-- can be pushed into the client's Basecamp project timesheet.
--   basecamp_entry_id    — Timesheet::Entry ID in Basecamp once synced
--   basecamp_project_id  — Basecamp project (bucket) the entry lives in
--   basecamp_synced_at   — last successful push
--   basecamp_sync_error  — human-readable reason the last push failed (cleared on success)

ALTER TABLE time_logs
  ADD COLUMN IF NOT EXISTS basecamp_entry_id BIGINT,
  ADD COLUMN IF NOT EXISTS basecamp_project_id BIGINT,
  ADD COLUMN IF NOT EXISTS basecamp_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS basecamp_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_time_logs_basecamp_entry
  ON time_logs (basecamp_entry_id)
  WHERE basecamp_entry_id IS NOT NULL;
