-- =============================================================================
-- 017_restrict_client_integrations_credentials.sql
-- Prevent browser/anon clients from selecting raw integration credentials.
--
-- The app now serves browser-safe integration status through
-- /api/integrations/status. Server routes that need OAuth tokens/API keys use
-- the Supabase service role. Because Postgres RLS cannot hide a single JSONB
-- column per row, direct SELECT policies on client_integrations are removed.
-- =============================================================================

DROP POLICY IF EXISTS "Org members can view client_integrations"
  ON public.client_integrations;

DROP POLICY IF EXISTS "Admins can manage client_integrations"
  ON public.client_integrations;

CREATE POLICY "Admins can insert client_integrations"
  ON public.client_integrations FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_admin_org_ids()));

CREATE POLICY "Admins can update client_integrations"
  ON public.client_integrations FOR UPDATE
  USING      (organization_id IN (SELECT public.get_user_admin_org_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_user_admin_org_ids()));

CREATE POLICY "Admins can delete client_integrations"
  ON public.client_integrations FOR DELETE
  USING (organization_id IN (SELECT public.get_user_admin_org_ids()));
