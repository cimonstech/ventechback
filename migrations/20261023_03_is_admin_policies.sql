-- Adds is_admin() policies next to existing role = 'admin' policies, so superadmin
-- can use the admin UI's direct Supabase writes. Existing policies are left untouched.
-- Scope per table matches the existing admin policies.

BEGIN;

-- Tables where admins currently have ALL
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'banners', 'brands', 'categories', 'deal_products', 'deals',
    'delivery_options', 'discounts', 'mega_menu_items',
    'product_attribute_option_mappings', 'product_attribute_options',
    'product_attributes', 'product_variant_stock', 'product_variants',
    'promotions', 'reviews', 'settings', 'sidebar_ads', 'taxes'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()))',
      'is_admin manages ' || t, t
    );
  END LOOP;
END $$;

-- orders: admins currently SELECT, UPDATE, DELETE (no INSERT)
CREATE POLICY "is_admin selects orders" ON public.orders
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "is_admin updates orders" ON public.orders
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "is_admin deletes orders" ON public.orders
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- order_items: admins currently SELECT only
CREATE POLICY "is_admin selects order items" ON public.order_items
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- notifications: admins currently SELECT, UPDATE, DELETE
CREATE POLICY "is_admin selects notifications" ON public.notifications
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "is_admin updates notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "is_admin deletes notifications" ON public.notifications
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- wishlists: admins currently SELECT only
CREATE POLICY "is_admin selects wishlists" ON public.wishlists
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

COMMIT;