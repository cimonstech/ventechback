BEGIN;

DROP POLICY IF EXISTS "staff permission selects orders" ON public.orders;
DROP POLICY IF EXISTS "staff permission selects order items" ON public.order_items;
DROP POLICY IF EXISTS "staff permission selects transactions" ON public.transactions;
DROP POLICY IF EXISTS "staff permission selects notifications" ON public.notifications;
DROP POLICY IF EXISTS "staff permission updates notifications" ON public.notifications;

DO $$
DECLARE
  t text;
  cmd text;
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
    'categories',
    'reviews',
    'banners',
    'sidebar_ads'
  ]
  LOOP
    FOREACH cmd IN ARRAY ARRAY['selects', 'inserts', 'updates', 'deletes']
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff permission ' || cmd || ' ' || t, t);
    END LOOP;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.has_staff_permission(text, text);

COMMIT;
