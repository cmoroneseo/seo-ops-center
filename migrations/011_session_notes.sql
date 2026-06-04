-- Migration 011: Session notes on in-progress timers
-- Stores append-only timestamped notes written during a tracking session.

ALTER TABLE time_logs
  ADD COLUMN IF NOT EXISTS session_notes JSONB NOT NULL DEFAULT '[]'::jsonb;
