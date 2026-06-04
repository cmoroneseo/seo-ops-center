-- Migration 007: Add source_type to metrics + create reports table

-- 1. Add source_type to metrics ('auto' = synced from API, 'manual' = AM entered)
ALTER TABLE public.metrics
  ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'auto'
  CHECK (source_type IN ('auto', 'manual'));

-- 2. Reports table
CREATE TABLE IF NOT EXISTS public.reports (
  id               uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id  uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  client_id        uuid REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  report_month     text NOT NULL,          -- 'YYYY-MM'
  title            text NOT NULL,
  executive_summary text,
  recommendations  text,
  sections         jsonb DEFAULT '[]'::jsonb, -- section visibility/order overrides
  status           text DEFAULT 'draft'
                   CHECK (status IN ('draft', 'published')),
  created_by       uuid REFERENCES public.users(id),
  created_at       timestamptz DEFAULT now() NOT NULL,
  updated_at       timestamptz DEFAULT now() NOT NULL,
  pdf_url          text
);

CREATE INDEX IF NOT EXISTS reports_org_client_idx
  ON public.reports (organization_id, client_id, report_month DESC);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view reports"
  ON public.reports FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "Org members can manage reports"
  ON public.reports FOR ALL
  USING      (organization_id IN (SELECT get_user_org_ids()))
  WITH CHECK (organization_id IN (SELECT get_user_org_ids()));
