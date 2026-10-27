-- Laptop banking (VLB) plans, applications, investors, investments, payouts,
-- documents, star redemptions, referral bonuses, and upgrade requests.
-- Reuses public.update_updated_at_column() for updated_at.
-- user_roles.role already allows investor; this file does not change that check.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.user_roles'::regclass
      AND pg_get_constraintdef(oid) ILIKE '%investor%'
  ) THEN
    RAISE EXCEPTION 'user_roles.role must already allow investor.';
  END IF;
END
$$;

CREATE SEQUENCE public.investor_no_seq START 1;

CREATE FUNCTION public.next_investor_no()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'VT-VLB-' || lpad(nextval('public.investor_no_seq')::text, 5, '0');
$$;

REVOKE EXECUTE ON FUNCTION public.next_investor_no() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_investor_no() TO service_role;

CREATE TABLE public.vlb_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_group text NOT NULL CHECK (plan_group IN ('vts', 'exclusive')),
  tier text NOT NULL,
  name text NOT NULL,
  principal_pesewas int NOT NULL CHECK (principal_pesewas > 0),
  version text NOT NULL DEFAULT 'V3.0',
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  terms_count int NOT NULL DEFAULT 3,
  months_per_term int NOT NULL DEFAULT 3,
  settlement_months int NOT NULL DEFAULT 1,
  term_rates_percent numeric(6,3)[] NOT NULL DEFAULT '{8,8,8}',
  rate_basis text NOT NULL DEFAULT 'per_month' CHECK (rate_basis IN ('per_month', 'per_term')),
  payout_frequency text NOT NULL DEFAULT 'monthly' CHECK (payout_frequency IN ('monthly', 'end_of_term')),
  scholar_fund_percent numeric(6,3) NOT NULL DEFAULT 1,
  scholar_fund_basis text NOT NULL DEFAULT 'gross_payout' CHECK (scholar_fund_basis IN ('gross_payout', 'principal')),
  premium_stars int NOT NULL DEFAULT 5,
  referral_bonus_percent numeric(6,3) NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_group, tier, version)
);

INSERT INTO public.vlb_plans (plan_group, tier, name, principal_pesewas, sort_order) VALUES
  ('vts', 'VIP 1', 'VTS VIP 1', 250000, 1),
  ('vts', 'VIP 2', 'VTS VIP 2', 500000, 2),
  ('vts', 'VIP 3', 'VTS VIP 3', 1000000, 3),
  ('exclusive', 'VIP 1', 'Exclusive VIP 1', 1500000, 4),
  ('exclusive', 'VIP 2', 'Exclusive VIP 2', 2000000, 5),
  ('exclusive', 'VIP 3', 'Exclusive VIP 3', 3000000, 6)
ON CONFLICT (plan_group, tier, version) DO NOTHING;

CREATE TABLE public.vlb_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  plan_id uuid REFERENCES public.vlb_plans(id) ON DELETE SET NULL,
  message text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'activated', 'declined')),
  handled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.investors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
  investor_no text UNIQUE,
  payout_method text CHECK (payout_method IN ('momo', 'bank')),
  momo_network text,
  momo_number text,
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  payout_details_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vlb_investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES public.investors(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.vlb_plans(id) ON DELETE RESTRICT,
  application_id uuid REFERENCES public.vlb_applications(id) ON DELETE SET NULL,
  plan_snapshot jsonb NOT NULL,
  principal_pesewas int NOT NULL CHECK (principal_pesewas > 0),
  start_date date NOT NULL,
  maturity_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settlement', 'settled', 'renewed')),
  renewal_choice text NOT NULL DEFAULT 'settle' CHECK (renewal_choice IN ('settle', 'renew')),
  renewal_chosen_at timestamptz,
  renewed_into_id uuid REFERENCES public.vlb_investments(id) ON DELETE SET NULL,
  payment_reference text,
  payment_method text,
  agreement_signed_at date,
  extra_rate_percent numeric(6,3) NOT NULL DEFAULT 0,
  stars_total int NOT NULL,
  stars_used int NOT NULL DEFAULT 0,
  activated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vlb_investments_stars_used_check CHECK (stars_used BETWEEN 0 AND stars_total)
);

CREATE TABLE public.vlb_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id uuid NOT NULL REFERENCES public.vlb_investments(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('return', 'principal')),
  term_no int,
  period_no int NOT NULL,
  due_date date NOT NULL,
  gross_pesewas int NOT NULL CHECK (gross_pesewas >= 0),
  scholar_pesewas int NOT NULL DEFAULT 0 CHECK (scholar_pesewas >= 0),
  net_pesewas int NOT NULL CHECK (net_pesewas >= 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'due', 'processing', 'paid')),
  paid_at timestamptz,
  method text,
  reference text,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investment_id, type, period_no)
);

CREATE INDEX vlb_payouts_status_due_date_idx
  ON public.vlb_payouts (status, due_date);

CREATE TABLE public.vlb_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES public.investors(id) ON DELETE CASCADE,
  investment_id uuid REFERENCES public.vlb_investments(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('agreement', 'receipt', 'statement', 'other')),
  title text NOT NULL,
  r2_key text NOT NULL UNIQUE,
  mime text NOT NULL,
  size_bytes int NOT NULL,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vlb_star_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id uuid NOT NULL REFERENCES public.vlb_investments(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  product_note text NOT NULL,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vlb_referral_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_investment_id uuid NOT NULL REFERENCES public.vlb_investments(id) ON DELETE RESTRICT,
  referred_investment_id uuid NOT NULL UNIQUE REFERENCES public.vlb_investments(id) ON DELETE RESTRICT,
  bonus_percent numeric(6,3) NOT NULL,
  applied_from_period int NOT NULL,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vlb_upgrade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES public.investors(id) ON DELETE CASCADE,
  current_investment_id uuid REFERENCES public.vlb_investments(id) ON DELETE SET NULL,
  requested_plan_id uuid REFERENCES public.vlb_plans(id) ON DELETE SET NULL,
  message text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'done', 'declined')),
  handled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_vlb_plans_updated_at
  BEFORE UPDATE ON public.vlb_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vlb_applications_updated_at
  BEFORE UPDATE ON public.vlb_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_investors_updated_at
  BEFORE UPDATE ON public.investors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vlb_investments_updated_at
  BEFORE UPDATE ON public.vlb_investments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vlb_payouts_updated_at
  BEFORE UPDATE ON public.vlb_payouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vlb_upgrade_requests_updated_at
  BEFORE UPDATE ON public.vlb_upgrade_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.vlb_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vlb_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vlb_investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vlb_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vlb_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vlb_star_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vlb_referral_bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vlb_upgrade_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active vlb plans"
  ON public.vlb_plans
  FOR SELECT
  TO anon, authenticated
  USING (is_active);

CREATE POLICY "Users can view own investor row"
  ON public.investors
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can view own vlb investments"
  ON public.vlb_investments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.investors
      WHERE investors.id = vlb_investments.investor_id
        AND investors.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view own vlb payouts"
  ON public.vlb_payouts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.vlb_investments
      JOIN public.investors ON investors.id = vlb_investments.investor_id
      WHERE vlb_investments.id = vlb_payouts.investment_id
        AND investors.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view own vlb star redemptions"
  ON public.vlb_star_redemptions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.vlb_investments
      JOIN public.investors ON investors.id = vlb_investments.investor_id
      WHERE vlb_investments.id = vlb_star_redemptions.investment_id
        AND investors.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view own vlb upgrade requests"
  ON public.vlb_upgrade_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.investors
      WHERE investors.id = vlb_upgrade_requests.investor_id
        AND investors.user_id = auth.uid()
    )
  );

COMMIT;

-- Expect tables=9, rls_on=9, policy_count=6, seeded_plans=6,
-- function_ok=true, anon_cannot_execute=true, user_roles_allows_investor=true.
SELECT
  (SELECT count(*)
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN (
       'vlb_plans',
       'vlb_applications',
       'investors',
       'vlb_investments',
       'vlb_payouts',
       'vlb_documents',
       'vlb_star_redemptions',
       'vlb_referral_bonuses',
       'vlb_upgrade_requests'
     )
  ) AS tables,
  (SELECT count(*)
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relrowsecurity
     AND c.relname IN (
       'vlb_plans',
       'vlb_applications',
       'investors',
       'vlb_investments',
       'vlb_payouts',
       'vlb_documents',
       'vlb_star_redemptions',
       'vlb_referral_bonuses',
       'vlb_upgrade_requests'
     )
  ) AS rls_on,
  (SELECT count(*)
   FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN (
       'vlb_plans',
       'vlb_applications',
       'investors',
       'vlb_investments',
       'vlb_payouts',
       'vlb_documents',
       'vlb_star_redemptions',
       'vlb_referral_bonuses',
       'vlb_upgrade_requests'
     )
  ) AS policy_count,
  (SELECT count(*)
   FROM public.vlb_plans
   WHERE version = 'V3.0'
     AND (
       (plan_group, tier, principal_pesewas) IN (
         ('vts', 'VIP 1', 250000),
         ('vts', 'VIP 2', 500000),
         ('vts', 'VIP 3', 1000000),
         ('exclusive', 'VIP 1', 1500000),
         ('exclusive', 'VIP 2', 2000000),
         ('exclusive', 'VIP 3', 3000000)
       )
     )
  ) AS seeded_plans,
  (SELECT pg_get_functiondef('public.next_investor_no()'::regprocedure) IS NOT NULL) AS function_ok,
  (NOT has_function_privilege('anon', 'public.next_investor_no()', 'EXECUTE')) AS anon_cannot_execute,
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.user_roles'::regclass
      AND pg_get_constraintdef(oid) ILIKE '%investor%'
  ) AS user_roles_allows_investor;
