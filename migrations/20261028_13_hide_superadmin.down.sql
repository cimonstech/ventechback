-- Rolls back 20261028_13_hide_superadmin.sql.

BEGIN;

DROP POLICY IF EXISTS "Admins can view audit log" ON public.audit_log;

DROP POLICY IF EXISTS "Admins can view all staff permissions" ON public.staff_permissions;
CREATE POLICY "Admins can view all staff permissions"
  ON public.staff_permissions
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
CREATE POLICY "Admins can view all users" ON public.users
  FOR SELECT
  USING ((auth.uid() = id) OR public.is_admin(auth.uid()));

DROP FUNCTION IF EXISTS public.entity_is_superadmin(text);
DROP FUNCTION IF EXISTS public.is_superadmin(uuid);

COMMIT;
