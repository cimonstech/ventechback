-- Hide superadmin profiles, permissions and audit rows from non-superadmin staff.
-- SELECT policies only. Do not run this file from the app. Apply it in the
-- database SQL editor.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_superadmin(user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = user_id
      AND role = 'superadmin'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.entity_is_superadmin(entity_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF entity_id IS NULL THEN
    RETURN false;
  END IF;
  IF entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  RETURN public.is_superadmin(entity_id::uuid);
END;
$$;

REVOKE ALL ON FUNCTION public.is_superadmin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_superadmin(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_superadmin(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_superadmin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_superadmin(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.entity_is_superadmin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.entity_is_superadmin(text) FROM anon;
REVOKE ALL ON FUNCTION public.entity_is_superadmin(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.entity_is_superadmin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.entity_is_superadmin(text) TO service_role;

DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
CREATE POLICY "Admins can view all users" ON public.users
  FOR SELECT
  USING (
    (auth.uid() = id)
    OR (
      public.is_admin(auth.uid())
      AND (
        public.is_superadmin(auth.uid())
        OR (role IS DISTINCT FROM 'superadmin')
      )
    )
  );

DROP POLICY IF EXISTS "Admins can view all staff permissions" ON public.staff_permissions;
CREATE POLICY "Admins can view all staff permissions"
  ON public.staff_permissions
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    AND (
      public.is_superadmin(auth.uid())
      OR NOT public.is_superadmin(user_id)
    )
  );

DROP POLICY IF EXISTS "Admins can view audit log" ON public.audit_log;
CREATE POLICY "Admins can view audit log"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    AND (
      public.is_superadmin(auth.uid())
      OR (
        (actor_id IS NULL OR NOT public.is_superadmin(actor_id))
        AND (actor_role IS DISTINCT FROM 'superadmin')
        AND (entity_id IS NULL OR NOT public.entity_is_superadmin(entity_id))
        AND COALESCE(before->>'role', '') IS DISTINCT FROM 'superadmin'
        AND COALESCE(after->>'role', '') IS DISTINCT FROM 'superadmin'
      )
    )
  );

COMMIT;

SELECT
  public.is_superadmin('00000000-0000-0000-0000-000000000000') IS NOT NULL AS is_superadmin_ok;
