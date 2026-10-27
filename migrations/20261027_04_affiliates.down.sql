-- Rolls back 20261027_04_affiliates.sql.
-- Drops new affiliate tables, then the added columns and the affiliate number sequence.
-- Restores the original affiliates status check.

BEGIN;

DELETE FROM public.settings
WHERE key IN (
  'affiliate_fee_pesewas',
  'affiliate_commission_pesewas',
  'affiliate_activation_mode',
  'affiliate_fee_refund_on_rejection',
  'affiliate_eligible_category_slugs',
  'affiliate_min_order_pesewas',
  'affiliate_attribution_days',
  'affiliate_return_window_days',
  'affiliate_withdrawal_min_pesewas',
  'affiliate_payout_change_hold_hours'
);

DROP TABLE public.affiliate_ledger;
DROP TABLE public.affiliate_withdrawals;
DROP TABLE public.affiliate_commissions;

DROP INDEX IF EXISTS public.orders_affiliate_id_idx;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS affiliate_id,
  DROP COLUMN IF EXISTS referral_click_id,
  DROP COLUMN IF EXISTS delivered_at;

DROP INDEX IF EXISTS public.affiliate_clicks_affiliate_id_created_at_idx;

DROP TRIGGER IF EXISTS affiliate_clicks_require_active ON public.affiliate_clicks;
DROP FUNCTION IF EXISTS public.affiliate_click_requires_active();

ALTER TABLE public.affiliate_clicks
  DROP COLUMN IF EXISTS landing_url,
  DROP COLUMN IF EXISTS product_id,
  DROP COLUMN IF EXISTS ip_hash;

ALTER TABLE public.affiliates
  DROP CONSTRAINT IF EXISTS affiliates_active_referral_matches_no;

COMMENT ON COLUMN public.affiliates.referral_code IS NULL;

ALTER TABLE public.affiliates
  DROP COLUMN IF EXISTS affiliate_no,
  DROP COLUMN IF EXISTS promo_channels,
  DROP COLUMN IF EXISTS social_handles,
  DROP COLUMN IF EXISTS payout_method,
  DROP COLUMN IF EXISTS momo_network,
  DROP COLUMN IF EXISTS momo_number,
  DROP COLUMN IF EXISTS bank_name,
  DROP COLUMN IF EXISTS bank_account_name,
  DROP COLUMN IF EXISTS bank_account_number,
  DROP COLUMN IF EXISTS payout_details_changed_at,
  DROP COLUMN IF EXISTS withdrawal_mode,
  DROP COLUMN IF EXISTS terms_version,
  DROP COLUMN IF EXISTS terms_accepted_at,
  DROP COLUMN IF EXISTS fee_amount_pesewas,
  DROP COLUMN IF EXISTS fee_reference,
  DROP COLUMN IF EXISTS fee_paid_at,
  DROP COLUMN IF EXISTS fee_refunded_at,
  DROP COLUMN IF EXISTS fee_refund_reference,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS rejected_reason,
  DROP COLUMN IF EXISTS suspended_reason;

ALTER TABLE public.affiliates
  DROP CONSTRAINT affiliates_status_check;

ALTER TABLE public.affiliates
  ADD CONSTRAINT affiliates_status_check CHECK (
    ((status)::text = ANY ((ARRAY[
      'pending'::character varying,
      'active'::character varying,
      'suspended'::character varying
    ])::text[]))
  );

ALTER TABLE public.affiliates
  ALTER COLUMN status SET DEFAULT 'pending';

DROP SEQUENCE public.affiliate_no_seq;

COMMIT;
