-- Affiliate commission on every product, with an optional category filter
-- and a choice of flat or percent payout. Do not run this file from the app.
-- Apply it in the database SQL editor.

BEGIN;

INSERT INTO public.settings (key, value, category, description) VALUES
  (
    'affiliate_eligible_scope',
    'all',
    'affiliate',
    'Which products earn commission: all, or only listed categories'
  ),
  (
    'affiliate_commission_mode',
    'flat',
    'affiliate',
    'Commission type: flat pesewas per order, or percent of eligible items'
  ),
  (
    'affiliate_commission_percent_bp',
    '0',
    'affiliate',
    'Percent commission in basis points (100 = 1 percent). Used when mode is percent'
  ),
  (
    'affiliate_commission_cap_pesewas',
    '',
    'affiliate',
    'Optional max commission in pesewas for percent mode. Empty means no cap'
  )
ON CONFLICT (key) DO NOTHING;

UPDATE public.settings
SET value = 'all',
    updated_at = now()
WHERE key = 'affiliate_eligible_scope'
  AND category = 'affiliate';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS affiliate_skip_reason text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_affiliate_skip_reason_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_affiliate_skip_reason_check CHECK (
    affiliate_skip_reason IS NULL
    OR affiliate_skip_reason IN (
      'below_minimum',
      'category_not_eligible',
      'self_referral',
      'refunded',
      'settings_error'
    )
  );

COMMENT ON COLUMN public.orders.affiliate_skip_reason IS
  'Why a referred order earned no commission. Null when a commission row exists.';

COMMIT;
