-- Migration 022: Custom report templates ("My templates").
-- Stock templates ship in code (lib/reports/reportTemplates.ts); this table
-- stores org-created layouts saved from the report builder.

CREATE TABLE IF NOT EXISTS public.report_templates (
  id              uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name            text NOT NULL,
  blocks          jsonb DEFAULT '[]'::jsonb NOT NULL, -- Block[] without ids
  created_by      uuid REFERENCES public.users(id),
  created_at      timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS report_templates_org_idx
  ON public.report_templates (organization_id, created_at DESC);

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view report templates"
  ON public.report_templates FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "Org members can manage report templates"
  ON public.report_templates FOR ALL
  USING      (organization_id IN (SELECT get_user_org_ids()))
  WITH CHECK (organization_id IN (SELECT get_user_org_ids()));
