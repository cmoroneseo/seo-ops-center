-- Migration 009: Make metrics.project_id nullable.
--
-- Why: migration 001 created `metrics.project_id uuid ... NOT NULL` (keyed on
-- the legacy `projects` table). Migration 004 moved the sync engine to
-- `client_id` as the natural key (client_id + source + metric_month) but left
-- the old NOT NULL `project_id` column in place.
--
-- Result: every sync insert from lib/sync/upsertMetric.ts violated the
-- project_id NOT NULL constraint (error 23502). Because upsertMetric swallows
-- the error and the sync route never checked its return value, the nightly /
-- manual sync reported "all sources updated" while writing zero rows.
--
-- The sync engine never populates project_id, so we drop the NOT NULL
-- constraint. The column and its FK are retained for backward compatibility
-- with any legacy project-scoped rows.

ALTER TABLE public.metrics
  ALTER COLUMN project_id DROP NOT NULL;
