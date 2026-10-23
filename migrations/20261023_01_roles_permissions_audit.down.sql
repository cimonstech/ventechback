-- Rolls back 20261023_01_roles_permissions_audit.sql.
-- Restores users_role_check, is_admin, and protect_user_role from 0000_baseline.sql.
-- Fails, and rolls back, if any public.users.role is 'staff'.

BEGIN;

DROP TABLE public.audit_log;
DROP TABLE public.staff_permissions;
DROP TABLE public.user_roles;

DROP FUNCTION public.has_admin_access(uuid);

CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM users
    WHERE id = user_id
    AND role = 'admin'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_user_role() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.role := 'customer';
  elsif new.role is distinct from old.role
        and not public.is_admin(auth.uid()) then
    raise exception 'Not allowed to change role' using errcode = '42501';
  end if;

  return new;
end;
$$;

ALTER TABLE public.users DROP CONSTRAINT users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (
    ((role)::text = ANY (ARRAY[
      ('customer'::character varying)::text,
      ('admin'::character varying)::text,
      ('superadmin'::character varying)::text
    ]))
  );

COMMIT;
