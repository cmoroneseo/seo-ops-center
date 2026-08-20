-- Close identity bootstrap, invitation, OAuth replay, and Basecamp recording
-- provenance gaps without rewriting any existing tenant or provider bindings.

DROP POLICY IF EXISTS "Authenticated users can join organizations during setup"
  ON public.organization_members;

DROP POLICY IF EXISTS "Authenticated users can create organizations"
  ON public.organizations;
CREATE POLICY "Authenticated users can create organizations"
  ON public.organizations FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid() AND is_internal = false);

CREATE OR REPLACE FUNCTION public.bootstrap_organization_owner(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  organization public.organizations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO organization
  FROM public.organizations
  WHERE id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND OR organization.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'organization owner bootstrap denied' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'organization owner already bootstrapped' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (p_organization_id, auth.uid(), 'owner');
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_organization_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_organization_owner(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.organization_invites (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email))),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'viewer')),
  invited_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  consumed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS organization_invites_expiry_idx
  ON public.organization_invites (expires_at) WHERE consumed_at IS NULL;
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_organization_invite(
  p_token_hash text,
  p_user_id uuid,
  p_email text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  invitation public.organization_invites%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO invitation
  FROM public.organization_invites
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND
     OR invitation.consumed_at IS NOT NULL
     OR invitation.expires_at <= now()
     OR p_email IS NULL
     OR invitation.email <> lower(btrim(p_email)) THEN
    RETURN false;
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (invitation.organization_id, p_user_id, invitation.role)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE public.organization_invites
  SET consumed_at = now(), consumed_by = p_user_id
  WHERE id = invitation.id AND consumed_at IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_organization_invite(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_organization_invite(text, uuid, text)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.basecamp_oauth_states (
  state_hash text PRIMARY KEY CHECK (length(state_hash) = 64),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  return_to text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS basecamp_oauth_states_expiry_idx
  ON public.basecamp_oauth_states (expires_at) WHERE consumed_at IS NULL;
ALTER TABLE public.basecamp_oauth_states ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.time_logs
  ADD COLUMN IF NOT EXISTS basecamp_recording_id bigint;

-- Replace migration 031's jsonb_each behavior with an explicit object check.
-- Malformed legacy OLD values are treated as having no Basecamp keys, while a
-- browser may never write a scalar/array NEW value or change Basecamp keys.
CREATE OR REPLACE FUNCTION public.protect_client_basecamp_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_basecamp_fields jsonb := '{}'::jsonb;
  new_basecamp_fields jsonb := '{}'::jsonb;
BEGIN
  IF auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN new;
  END IF;

  IF jsonb_typeof(COALESCE(new.custom_fields, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'clients.custom_fields must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF tg_op = 'UPDATE'
     AND jsonb_typeof(COALESCE(old.custom_fields, '{}'::jsonb)) = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
      INTO old_basecamp_fields
      FROM jsonb_each(COALESCE(old.custom_fields, '{}'::jsonb)) AS entry
      WHERE entry.key LIKE 'basecamp\_%' ESCAPE '\';
  END IF;

  SELECT COALESCE(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    INTO new_basecamp_fields
    FROM jsonb_each(COALESCE(new.custom_fields, '{}'::jsonb)) AS entry
    WHERE entry.key LIKE 'basecamp\_%' ESCAPE '\';

  IF new_basecamp_fields IS DISTINCT FROM old_basecamp_fields THEN
    RAISE EXCEPTION 'clients.custom_fields Basecamp keys are server-controlled'
      USING ERRCODE = '42501';
  END IF;

  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_time_log_basecamp_tuple()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN new;
  END IF;

  IF tg_op = 'INSERT'
     AND (new.basecamp_entry_id IS NOT NULL OR new.basecamp_recording_id IS NOT NULL) THEN
    RAISE EXCEPTION 'time log Basecamp linkage is server-controlled'
      USING ERRCODE = '42501';
  END IF;

  IF tg_op = 'UPDATE'
     AND (
       new.basecamp_entry_id IS DISTINCT FROM old.basecamp_entry_id
       OR new.basecamp_recording_id IS DISTINCT FROM old.basecamp_recording_id
       OR ((old.basecamp_entry_id IS NOT NULL OR old.basecamp_recording_id IS NOT NULL)
           AND new.basecamp_project_id IS DISTINCT FROM old.basecamp_project_id)
     ) THEN
    RAISE EXCEPTION 'time log Basecamp linkage is server-controlled'
      USING ERRCODE = '42501';
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS protect_time_log_basecamp_entry ON public.time_logs;
DROP FUNCTION IF EXISTS public.protect_time_log_basecamp_entry();
DROP TRIGGER IF EXISTS protect_time_log_basecamp_tuple ON public.time_logs;
CREATE TRIGGER protect_time_log_basecamp_tuple
  BEFORE INSERT OR UPDATE OF basecamp_entry_id, basecamp_project_id, basecamp_recording_id
  ON public.time_logs
  FOR EACH ROW EXECUTE FUNCTION public.protect_time_log_basecamp_tuple();
