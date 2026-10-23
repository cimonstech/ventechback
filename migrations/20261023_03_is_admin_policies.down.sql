BEGIN;

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
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'is_admin manages ' || t, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "is_admin selects orders" ON public.orders;
DROP POLICY IF EXISTS "is_admin updates orders" ON public.orders;
DROP POLICY IF EXISTS "is_admin deletes orders" ON public.orders;
DROP POLICY IF EXISTS "is_admin selects order items" ON public.order_items;
DROP POLICY IF EXISTS "is_admin selects notifications" ON public.notifications;
DROP POLICY IF EXISTS "is_admin updates notifications" ON public.notifications;
DROP POLICY IF EXISTS "is_admin deletes notifications" ON public.notifications;
DROP POLICY IF EXISTS "is_admin selects wishlists" ON public.wishlists;

COMMIT;