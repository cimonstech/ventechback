-- Product saves from the admin UI use the logged-in Supabase session, so RLS applies.
-- "Admins can manage products" and the attribute-mapping policy only allow role = 'admin'.
-- is_admin() already returns true for admin and superadmin.

BEGIN;

CREATE POLICY "is_admin manages products"
  ON public.products
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "is_admin manages product attribute mappings"
  ON public.product_attribute_mappings
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMIT;
