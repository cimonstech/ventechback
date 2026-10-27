-- Affiliate application, commissions, withdrawals, and ledger.
-- Alters existing public.affiliates and public.affiliate_clicks; does not recreate them.
-- Reuses public.update_updated_at_column() for updated_at.
-- referral_code stays NOT NULL unique varchar(20). At registration the API stores
-- PENDING- plus 10 random characters (18 chars). On approval the API sets both
-- affiliate_no and referral_code to VT-AFF-00001 from affiliate_no_seq.
-- Click inserts are rejected unless the affiliate status is active, so placeholders
-- cannot attribute an order.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

CREATE SEQUENCE public.affiliate_no_seq START 1;

ALTER TABLE public.affiliates
  DROP CONSTRAINT affiliates_status_check;

ALTER TABLE public.affiliates
  ADD CONSTRAINT affiliates_status_check CHECK (
    ((status)::text = ANY ((ARRAY[
      'awaiting_payment'::character varying,
      'pending'::character varying,
      'active'::character varying,
      'suspended'::character varying,
      'rejected'::character varying
    ])::text[]))
  );

ALTER TABLE public.affiliates
  ALTER COLUMN status SET DEFAULT 'awaiting_payment';

ALTER TABLE public.affiliates
  ADD COLUMN affiliate_no text UNIQUE,
  ADD COLUMN promo_channels text[],
  ADD COLUMN social_handles jsonb,
  ADD COLUMN payout_method text CHECK (payout_method IN ('momo', 'bank')),
  ADD COLUMN momo_network text,
  ADD COLUMN momo_number text,
  ADD COLUMN bank_name text,
  ADD COLUMN bank_account_name text,
  ADD COLUMN bank_account_number text,
  ADD COLUMN payout_details_changed_at timestamptz,
  ADD COLUMN withdrawal_mode text NOT NULL DEFAULT 'anytime' CHECK (withdrawal_mode IN ('anytime', 'month_end')),
  ADD COLUMN terms_version int,
  ADD COLUMN terms_accepted_at timestamptz,
  ADD COLUMN fee_amount_pesewas int,
  ADD COLUMN fee_reference text UNIQUE,
  ADD COLUMN fee_paid_at timestamptz,
  ADD COLUMN fee_refunded_at timestamptz,
  ADD COLUMN fee_refund_reference text,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN rejected_reason text,
  ADD COLUMN suspended_reason text;

ALTER TABLE public.affiliates
  ADD CONSTRAINT affiliates_active_referral_matches_no CHECK (
    status <> 'active'
    OR (affiliate_no IS NOT NULL AND (referral_code)::text = affiliate_no)
  );

COMMENT ON COLUMN public.affiliates.referral_code IS
  'Unique tracking code. PENDING- plus 10 random characters until approval, then equal to affiliate_no.';
COMMENT ON COLUMN public.affiliates.affiliate_no IS
  'VT-AFF-00001 from public.affiliate_no_seq. Assigned on approval; referral_code is then set to the same value.';

ALTER TABLE public.affiliate_clicks
  ADD COLUMN landing_url text,
  ADD COLUMN product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN ip_hash text;

CREATE INDEX affiliate_clicks_affiliate_id_created_at_idx
  ON public.affiliate_clicks (affiliate_id, created_at DESC);

CREATE FUNCTION public.affiliate_click_requires_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.affiliates
    WHERE id = NEW.affiliate_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Affiliate is not active.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER affiliate_clicks_require_active
  BEFORE INSERT OR UPDATE OF affiliate_id ON public.affiliate_clicks
  FOR EACH ROW
  EXECUTE FUNCTION public.affiliate_click_requires_active();

ALTER TABLE public.orders
  ADD COLUMN affiliate_id uuid REFERENCES public.affiliates(id) ON DELETE SET NULL,
  ADD COLUMN referral_click_id uuid REFERENCES public.affiliate_clicks(id) ON DELETE SET NULL,
  ADD COLUMN delivered_at timestamptz;

CREATE INDEX orders_affiliate_id_idx
  ON public.orders (affiliate_id);

CREATE TABLE public.affiliate_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  checkout_reference text NOT NULL UNIQUE,
  amount_pesewas int NOT NULL CHECK (amount_pesewas > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'reversed')),
  eligible_from timestamptz,
  reason text,
  verified_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX affiliate_commissions_affiliate_id_status_idx
  ON public.affiliate_commissions (affiliate_id, status);

CREATE INDEX affiliate_commissions_status_eligible_from_idx
  ON public.affiliate_commissions (status, eligible_from);

CREATE TABLE public.affiliate_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  amount_pesewas int NOT NULL CHECK (amount_pesewas > 0),
  mode text NOT NULL CHECK (mode IN ('anytime', 'month_end')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'approved', 'paid', 'rejected')),
  payout_snapshot jsonb NOT NULL,
  reason text,
  payment_reference text,
  processed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  processed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX affiliate_withdrawals_one_open_uidx
  ON public.affiliate_withdrawals (affiliate_id)
  WHERE status IN ('requested', 'processing', 'approved');

CREATE TABLE public.affiliate_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('commission_approved', 'commission_adjustment', 'withdrawal_reserved', 'withdrawal_released')),
  amount_pesewas int NOT NULL,
  commission_id uuid REFERENCES public.affiliate_commissions(id) ON DELETE RESTRICT,
  withdrawal_id uuid REFERENCES public.affiliate_withdrawals(id) ON DELETE RESTRICT,
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX affiliate_ledger_affiliate_id_created_at_idx
  ON public.affiliate_ledger (affiliate_id, created_at);

CREATE UNIQUE INDEX affiliate_ledger_commission_id_type_uidx
  ON public.affiliate_ledger (commission_id, type)
  WHERE commission_id IS NOT NULL;

CREATE TRIGGER trigger_update_affiliate_commissions_updated_at
  BEFORE UPDATE ON public.affiliate_commissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_update_affiliate_withdrawals_updated_at
  BEFORE UPDATE ON public.affiliate_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Affiliates can select own commissions"
  ON public.affiliate_commissions
  FOR SELECT
  USING (
    affiliate_id = (
      SELECT affiliates.id
      FROM public.affiliates
      WHERE affiliates.user_id = auth.uid()
    )
  );

CREATE POLICY "Affiliates can select own withdrawals"
  ON public.affiliate_withdrawals
  FOR SELECT
  USING (
    affiliate_id = (
      SELECT affiliates.id
      FROM public.affiliates
      WHERE affiliates.user_id = auth.uid()
    )
  );

CREATE POLICY "Affiliates can select own ledger"
  ON public.affiliate_ledger
  FOR SELECT
  USING (
    affiliate_id = (
      SELECT affiliates.id
      FROM public.affiliates
      WHERE affiliates.user_id = auth.uid()
    )
  );

INSERT INTO public.settings (key, value, category, description) VALUES
  ('affiliate_fee_pesewas', '30000', 'affiliate', 'One-time affiliate application fee in pesewas'),
  ('affiliate_commission_pesewas', '20000', 'affiliate', 'Commission per eligible order in pesewas'),
  ('affiliate_activation_mode', 'approval', 'affiliate', 'How a paid application becomes active'),
  ('affiliate_fee_refund_on_rejection', 'true', 'affiliate', 'Refund the application fee when rejected'),
  ('affiliate_eligible_category_slugs', 'laptops', 'affiliate', 'Category slugs that earn commission'),
  ('affiliate_min_order_pesewas', '0', 'affiliate', 'Minimum order total in pesewas for commission'),
  ('affiliate_attribution_days', '30', 'affiliate', 'Days a click can attribute an order'),
  ('affiliate_return_window_days', '7', 'affiliate', 'Days after delivery before commission is eligible'),
  ('affiliate_withdrawal_min_pesewas', '20000', 'affiliate', 'Minimum withdrawal in pesewas'),
  ('affiliate_payout_change_hold_hours', '48', 'affiliate', 'Hours to hold withdrawals after payout details change')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- Expect new_tables=3, rls_on=3, policy_count=3, settings_count=10,
-- sequence_exists=true, affiliate_new_columns=22, click_new_columns=3,
-- order_new_columns=3, active_code_check=true, click_active_trigger=true,
-- affiliates_status_default includes awaiting_payment.
SELECT
  (SELECT count(*)
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN ('affiliate_commissions', 'affiliate_withdrawals', 'affiliate_ledger')
  ) AS new_tables,
  (SELECT count(*)
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relrowsecurity
     AND c.relname IN ('affiliate_commissions', 'affiliate_withdrawals', 'affiliate_ledger')
  ) AS rls_on,
  (SELECT count(*)
   FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('affiliate_commissions', 'affiliate_withdrawals', 'affiliate_ledger')
  ) AS policy_count,
  (SELECT count(*)
   FROM public.settings
   WHERE category = 'affiliate'
     AND key IN (
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
     )
  ) AS settings_count,
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND c.relname = 'affiliate_no_seq'
  ) AS sequence_exists,
  (SELECT pg_get_constraintdef(oid)
   FROM pg_constraint
   WHERE conrelid = 'public.affiliates'::regclass
     AND conname = 'affiliates_status_check'
  ) AS affiliates_status_check,
  (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'affiliates'
      AND column_name = 'status'
  ) AS affiliates_status_default,
  (SELECT count(*)
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'affiliates'
     AND column_name IN (
       'affiliate_no', 'promo_channels', 'social_handles', 'payout_method',
       'momo_network', 'momo_number', 'bank_name', 'bank_account_name',
       'bank_account_number', 'payout_details_changed_at', 'withdrawal_mode',
       'terms_version', 'terms_accepted_at', 'fee_amount_pesewas', 'fee_reference',
       'fee_paid_at', 'fee_refunded_at', 'fee_refund_reference', 'approved_at',
       'approved_by', 'rejected_reason', 'suspended_reason'
     )
  ) AS affiliate_new_columns,
  (SELECT count(*)
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'affiliate_clicks'
     AND column_name IN ('landing_url', 'product_id', 'ip_hash')
  ) AS click_new_columns,
  (SELECT count(*)
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'orders'
     AND column_name IN ('affiliate_id', 'referral_click_id', 'delivered_at')
  ) AS order_new_columns,
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.affiliates'::regclass
      AND conname = 'affiliates_active_referral_matches_no'
  ) AS active_code_check,
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.affiliate_clicks'::regclass
      AND tgname = 'affiliate_clicks_require_active'
      AND NOT tgisinternal
  ) AS click_active_trigger;
