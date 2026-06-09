-- Migration 013: In-App Notifications
-- Adds notifications table for task assignment and @mention events
-- Also adds mentions column to client_notes for storing resolved user IDs

-- ============================================================
-- notifications table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id              uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id         uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  type            text NOT NULL CHECK (type IN ('task_assigned', 'task_mentioned', 'note_mentioned')),
  title           text NOT NULL,
  body            text,
  entity_type     text CHECK (entity_type IN ('task', 'task_comment', 'client_note')),
  entity_id       text,
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  is_read         boolean NOT NULL DEFAULT false,
  created_at      timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON public.notifications (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_org_idx
  ON public.notifications (organization_id, created_at DESC);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Org members create notifications" ON public.notifications;
CREATE POLICY "Org members create notifications" ON public.notifications
  FOR INSERT WITH CHECK (organization_id IN (SELECT get_user_org_ids()));

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());

-- ============================================================
-- Add mentions column to client_notes
-- ============================================================
ALTER TABLE public.client_notes
  ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';

-- ============================================================
-- Realtime
-- NOTE: Run this separately in the Supabase Dashboard SQL editor
-- (requires superuser / supabase_realtime role):
--
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
--
-- This cannot be run from a regular migration. Execute it once
-- manually after applying this migration file.
-- ============================================================
