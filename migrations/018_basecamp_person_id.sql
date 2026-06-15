-- Migration 018: Add basecamp_person_id to organization_members
-- Stores each team member's Basecamp person ID for assignee mapping on task push

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS basecamp_person_id TEXT;
