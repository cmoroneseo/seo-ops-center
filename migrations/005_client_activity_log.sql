-- =============================================================================
-- 005_client_activity_log.sql
-- General-purpose audit log for client-level events. First use: integration
-- connect/disconnect/reconfigure events. Designed to absorb future event types
-- (deliverable status changes, budget edits, etc.) without schema changes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.client_activity_log (
  id               uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id  uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  client_id        uuid REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  event_type       text NOT NULL,
  -- e.g. 'integration.connected', 'integration.disconnected', 'integration.reconfigured'
  actor_id         uuid REFERENCES public.users(id),
  actor_name       text,                        -- fallback display name
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- integration events: { service, property_id, display_name, old_property_id }
  occurred_at      timestamptz DEFAULT now() NOT NULL,
  created_at       timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS client_activity_log_client_idx
  ON public.client_activity_log (client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS client_activity_log_org_idx
  ON public.client_activity_log (organization_id, occurred_at DESC);

ALTER TABLE public.client_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view client_activity_log"
  ON public.client_activity_log FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

-- Writes happen server-side via service role — no INSERT policy needed for anon/authed.
