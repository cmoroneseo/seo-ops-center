-- Migration 014: Make tasks.project_id nullable
--
-- The original schema (001) created tasks.project_id as NOT NULL, but tasks
-- are created from the client detail page where no specific project is selected.
-- project_id is optional context — client_id is the primary scope for tasks.

ALTER TABLE public.tasks
  ALTER COLUMN project_id DROP NOT NULL;
