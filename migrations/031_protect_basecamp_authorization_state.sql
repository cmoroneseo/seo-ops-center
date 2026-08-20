-- =============================================================================
-- 031_protect_basecamp_authorization_state.sql
-- Keeps provider authorization state server-owned without rewriting legacy data.
--
-- Existing is_internal values and Basecamp client bindings are intentionally
-- preserved. Going forward, authenticated browser writes may still update other
-- organization/client fields, but only service-role requests may change these
-- trust-sensitive values. Operators can use the service-role API/SQL session;
-- database audit logs then identify the privileged writer and statement.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.protect_organization_internal_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.is_internal IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'organizations.is_internal is server-controlled'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.is_internal IS DISTINCT FROM OLD.is_internal THEN
    RAISE EXCEPTION 'organizations.is_internal is server-controlled'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_organization_internal_status
  ON public.organizations;
CREATE TRIGGER protect_organization_internal_status
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.protect_organization_internal_status();

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
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
      INTO old_basecamp_fields
      FROM jsonb_each(COALESCE(OLD.custom_fields, '{}'::jsonb)) AS entry
      WHERE entry.key LIKE 'basecamp\_%' ESCAPE '\';
  END IF;

  SELECT COALESCE(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    INTO new_basecamp_fields
    FROM jsonb_each(COALESCE(NEW.custom_fields, '{}'::jsonb)) AS entry
    WHERE entry.key LIKE 'basecamp\_%' ESCAPE '\';

  IF new_basecamp_fields IS DISTINCT FROM old_basecamp_fields THEN
    RAISE EXCEPTION 'clients.custom_fields Basecamp keys are server-controlled'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_client_basecamp_fields ON public.clients;
CREATE TRIGGER protect_client_basecamp_fields
  BEFORE INSERT OR UPDATE OF custom_fields ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.protect_client_basecamp_fields();

CREATE OR REPLACE FUNCTION public.protect_task_basecamp_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     AND (NEW.basecamp_todo_id IS NOT NULL OR NEW.basecamp_project_id IS NOT NULL) THEN
    RAISE EXCEPTION 'task Basecamp linkage is server-controlled'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.basecamp_todo_id IS DISTINCT FROM OLD.basecamp_todo_id
          OR NEW.basecamp_project_id IS DISTINCT FROM OLD.basecamp_project_id) THEN
    RAISE EXCEPTION 'task Basecamp linkage is server-controlled'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_task_basecamp_linkage ON public.tasks;
CREATE TRIGGER protect_task_basecamp_linkage
  BEFORE INSERT OR UPDATE OF basecamp_todo_id, basecamp_project_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.protect_task_basecamp_linkage();

CREATE OR REPLACE FUNCTION public.protect_time_log_basecamp_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.basecamp_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'time log Basecamp entry linkage is server-controlled'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.basecamp_entry_id IS DISTINCT FROM OLD.basecamp_entry_id THEN
    RAISE EXCEPTION 'time log Basecamp entry linkage is server-controlled'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_time_log_basecamp_entry ON public.time_logs;
CREATE TRIGGER protect_time_log_basecamp_entry
  BEFORE INSERT OR UPDATE OF basecamp_entry_id ON public.time_logs
  FOR EACH ROW EXECUTE FUNCTION public.protect_time_log_basecamp_entry();
