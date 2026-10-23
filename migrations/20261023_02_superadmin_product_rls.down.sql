BEGIN;

DROP POLICY "is_admin manages products" ON public.products;
DROP POLICY "is_admin manages product attribute mappings" ON public.product_attribute_mappings;

COMMIT;
