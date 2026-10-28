-- Staff with a module permission can read (and, where the admin UI writes
-- through the browser session, write) the same rows admins see on that module.
-- Additive: existing policies are not replaced.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

CREATE OR REPLACE FUNCTION public.has_staff_permission(p_module text, p_level text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND p_level IN ('view', 'edit')
    AND p_module IN ('orders', 'products', 'content', 'devices', 'tickets', 'affiliates', 'vlb', 'finance')
    AND (
      EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role IN ('admin', 'superadmin')
      )
      OR EXISTS (
        SELECT 1
        FROM public.staff_permissions sp
        INNER JOIN public.users u ON u.id = sp.user_id
        WHERE sp.user_id = auth.uid()
          AND u.role = 'staff'
          AND sp.module = p_module
          AND (
            (p_level = 'edit' AND sp.can_edit = true)
            OR (p_level = 'view' AND (sp.can_view = true OR sp.can_edit = true))
          )
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.has_staff_permission(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_staff_permission(text, text) TO authenticated, service_role;

-- orders / finance pages read orders through the browser when the API is skipped
CREATE POLICY "staff permission selects orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    public.has_staff_permission('orders', 'view')
    OR public.has_staff_permission('finance', 'view')
  );

CREATE POLICY "staff permission selects order items"
  ON public.order_items
  FOR SELECT
  TO authenticated
  USING (
    public.has_staff_permission('orders', 'view')
    OR public.has_staff_permission('finance', 'view')
  );

CREATE POLICY "staff permission selects transactions"
  ON public.transactions
  FOR SELECT
  TO authenticated
  USING (public.has_staff_permission('finance', 'view'));

CREATE POLICY "staff permission selects notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (public.has_staff_permission('orders', 'view'));

CREATE POLICY "staff permission updates notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (public.has_staff_permission('orders', 'edit'))
  WITH CHECK (public.has_staff_permission('orders', 'edit'));

-- products module: catalog tables the admin UI reads and writes in-browser
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products',
    'product_attributes',
    'product_attribute_options',
    'product_attribute_mappings',
    'product_attribute_option_mappings',
    'product_selected_options',
    'product_variants',
    'product_variant_stock',
    'brands',
    'categories'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_staff_permission(%L, %L))',
      'staff permission selects ' || t, t, 'products', 'view'
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_staff_permission(%L, %L))',
      'staff permission inserts ' || t, t, 'products', 'edit'
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_staff_permission(%L, %L)) WITH CHECK (public.has_staff_permission(%L, %L))',
      'staff permission updates ' || t, t, 'products', 'edit', 'products', 'edit'
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_staff_permission(%L, %L))',
      'staff permission deletes ' || t, t, 'products', 'edit'
    );
  END LOOP;
END $$;

-- reviews: staff may read and delete; customers remain the writers
CREATE POLICY "staff permission selects reviews"
  ON public.reviews
  FOR SELECT
  TO authenticated
  USING (public.has_staff_permission('products', 'view'));

CREATE POLICY "staff permission deletes reviews"
  ON public.reviews
  FOR DELETE
  TO authenticated
  USING (public.has_staff_permission('products', 'edit'));

-- content module: banners and sidebar ads (inactive rows are admin-only today)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['banners', 'sidebar_ads']
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_staff_permission(%L, %L))',
      'staff permission selects ' || t, t, 'content', 'view'
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_staff_permission(%L, %L))',
      'staff permission inserts ' || t, t, 'content', 'edit'
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_staff_permission(%L, %L)) WITH CHECK (public.has_staff_permission(%L, %L))',
      'staff permission updates ' || t, t, 'content', 'edit', 'content', 'edit'
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_staff_permission(%L, %L))',
      'staff permission deletes ' || t, t, 'content', 'edit'
    );
  END LOOP;
END $$;

COMMIT;

SELECT public.has_staff_permission('finance', 'view') IS NOT NULL AS staff_perm_ok;
