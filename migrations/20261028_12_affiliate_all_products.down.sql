-- Rolls back 20261028_12_affiliate_all_products.sql.

BEGIN;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_affiliate_skip_reason_check;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS affiliate_skip_reason;

DELETE FROM public.settings
WHERE category = 'affiliate'
  AND key IN (
    'affiliate_eligible_scope',
    'affiliate_commission_mode',
    'affiliate_commission_percent_bp',
    'affiliate_commission_cap_pesewas'
  );

UPDATE public.settings
SET value = 'laptops',
    updated_at = now()
WHERE key = 'affiliate_eligible_category_slugs'
  AND category = 'affiliate';

COMMIT;
