-- Roles, staff permissions, and audit log.
-- Reuses public.update_updated_at_column() for updated_at.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

ALTER TABLE public.users DROP CONSTRAINT users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (
    (role)::text = ANY (ARRAY[
      ('customer'::character varying)::text,
      ('staff'::character varying)::text,
      ('admin'::character varying)::text,
      ('superadmin'::character varying)::text
    ])
  );

CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM users
    WHERE id = user_id
    AND role IN ('admin', 'superadmin')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.has_admin_access(user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM users
    WHERE id = user_id
    AND role IN ('staff', 'admin', 'superadmin')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_user_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
declare
  actor_role text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.role := 'customer';
  elsif new.role is distinct from old.role then
    select u.role into actor_role
    from public.users u
    where u.id = auth.uid();

    if actor_role = 'superadmin' then
      return new;
    elsif actor_role = 'admin'
          and old.role::text in ('customer', 'staff')
          and new.role::text in ('customer', 'staff') then
      return new;
    else
      raise exception 'Not allowed to change role' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('affiliate', 'investor')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
  granted_at timestamptz,
    granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE public.staff_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  module text NOT NULL CHECK (module IN ('orders', 'products', 'content', 'devices', 'tickets', 'affiliates', 'vlb', 'finance')),
  can_view boolean NOT NULL DEFAULT true,
  can_edit boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, module)
);

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role text,
  entity text NOT NULL,
  entity_id text,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_entity_id_idx ON public.audit_log (entity, entity_id);
CREATE INDEX audit_log_created_at_idx ON public.audit_log (created_at DESC);

CREATE TRIGGER update_user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_staff_permissions_updated_at
  BEFORE UPDATE ON public.staff_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own user roles"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can view own staff permissions"
  ON public.staff_permissions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all staff permissions"
  ON public.staff_permissions
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

COMMIT;
