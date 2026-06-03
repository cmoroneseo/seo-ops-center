-- =============================================================================
-- 004_client_integrations.sql
-- Adds the client_integrations and sync_runs tables, and extends the metrics
-- table to support direct client lookup and all four data sources.
-- Run this against the live Supabase project (sgszojorcftyaknruckh).
-- =============================================================================

-- 1. Extend metrics: add client_id for direct lookup + metric_month for rollups
--    and widen the source check to include gbp and ahrefs.
ALTER TABLE public.metrics
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS metric_month text,   -- 'YYYY-MM'
  ADD COLUMN IF NOT EXISTS sync_run_id uuid;

-- Drop the old source constraint and replace with updated one
ALTER TABLE public.metrics
  DROP CONSTRAINT IF EXISTS metrics_source_check;

ALTER TABLE public.metrics
  ADD CONSTRAINT metrics_source_check
  CHECK (source IN ('gsc', 'ga4', 'gbp', 'ahrefs'));

CREATE INDEX IF NOT EXISTS metrics_client_month_idx
  ON public.metrics (client_id, metric_month);


-- 2. Stores OAuth tokens (Google) and API keys (Ahrefs) per client per service.
--    credentials JSONB stores: { access_token, refresh_token, expiry_at, property_id, ... }
--    Tokens should be considered sensitive — limit access via RLS below.
CREATE TABLE IF NOT EXISTS public.client_integrations (
  id               uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id  uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  client_id        uuid REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  service          text NOT NULL
                   CHECK (service IN ('ga4', 'gsc', 'gbp', 'ahrefs')),
  credentials      jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_by     uuid REFERENCES public.users(id),
  connected_at     timestamptz DEFAULT now(),
  last_synced_at   timestamptz,
  sync_status      text DEFAULT 'active'
                   CHECK (sync_status IN ('active', 'error', 'disconnected')),
  error_message    text,
  created_at       timestamptz DEFAULT now() NOT NULL,
  UNIQUE (client_id, service)
);

CREATE INDEX IF NOT EXISTS client_integrations_org_idx
  ON public.client_integrations (organization_id);
CREATE INDEX IF NOT EXISTS client_integrations_client_idx
  ON public.client_integrations (client_id);


-- 3. sync_runs: one row per cron execution. Tracks success/failure per org
--    so we can surface token-expiry errors to admins quickly.
CREATE TABLE IF NOT EXISTS public.sync_runs (
  id               uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id  uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  started_at       timestamptz DEFAULT now() NOT NULL,
  finished_at      timestamptz,
  status           text DEFAULT 'running'
                   CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  clients_synced   integer DEFAULT 0,
  clients_errored  integer DEFAULT 0,
  error_summary    jsonb DEFAULT '[]'::jsonb,   -- [{ client_id, service, message }]
  created_at       timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_runs_org_idx
  ON public.sync_runs (organization_id, started_at DESC);


-- =============================================================================
-- Row Level Security
-- =============================================================================
ALTER TABLE public.client_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_runs           ENABLE ROW LEVEL SECURITY;

-- client_integrations: org admins/owners manage; members can read (so they can
-- see which integrations are connected without exposing token values in UI).
CREATE POLICY "Org members can view client_integrations"
  ON public.client_integrations FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "Admins can manage client_integrations"
  ON public.client_integrations FOR ALL
  USING      (organization_id IN (SELECT public.get_user_admin_org_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_user_admin_org_ids()));

-- sync_runs: org members can view their own org's run history.
CREATE POLICY "Org members can view sync_runs"
  ON public.sync_runs FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));
