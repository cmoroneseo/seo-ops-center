-- =============================================================================
-- 016_organization_member_permissions.sql
-- Adds narrow per-member permissions so trusted non-admin team members can manage
-- sensitive integrations without receiving broad organization admin privileges.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.organization_member_permissions (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  can_manage_integrations boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES public.organization_members(organization_id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS organization_member_permissions_org_idx
  ON public.organization_member_permissions (organization_id);

CREATE INDEX IF NOT EXISTS organization_member_permissions_user_idx
  ON public.organization_member_permissions (user_id);

ALTER TABLE public.organization_member_permissions ENABLE ROW LEVEL SECURITY;

-- Org members can view permission flags for their org so the app can explain
-- available capabilities without exposing unrelated organizations.
CREATE POLICY "Org members can view member permissions"
  ON public.organization_member_permissions FOR SELECT
  USING (organization_id IN (SELECT public.get_user_org_ids()));

-- Owners/admins manage narrow permission grants. Members cannot self-grant.
CREATE POLICY "Admins can manage member permissions"
  ON public.organization_member_permissions FOR ALL
  USING      (organization_id IN (SELECT public.get_user_admin_org_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_user_admin_org_ids()));

-- Backfill a permission row for every existing membership with all flags off.
INSERT INTO public.organization_member_permissions (organization_id, user_id)
SELECT organization_id, user_id
FROM public.organization_members
ON CONFLICT (organization_id, user_id) DO NOTHING;
