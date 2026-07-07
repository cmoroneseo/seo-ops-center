-- Migration 023: Allow reports to be created without a client assigned.
--
-- Why: "Create Report" previously had to guess a default client, which
-- silently attached new reports to whichever client happened to be first
-- in the list. A report should start blank and only pull data once the
-- user explicitly picks a client (and, optionally, period) in the
-- builder's Settings tab.

ALTER TABLE public.reports
  ALTER COLUMN client_id DROP NOT NULL;
