-- Renew a Laptop Banking investment and record a star redemption atomically.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

CREATE OR REPLACE FUNCTION public.renew_vlb_investment(
  p_old_investment_id uuid,
  p_new_plan_id uuid,
  p_principal_pesewas int,
  p_start_date date,
  p_maturity_date date,
  p_plan_snapshot jsonb,
  p_payouts jsonb,
  p_stars_total int,
  p_renewed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_inv public.vlb_investments%ROWTYPE;
  principal public.vlb_payouts%ROWTYPE;
  new_id uuid;
BEGIN
  IF p_payouts IS NULL OR jsonb_typeof(p_payouts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_payouts) < 1 THEN
    RAISE EXCEPTION 'Payout schedule is missing.';
  END IF;

  IF p_principal_pesewas IS NULL OR p_principal_pesewas <= 0 THEN
    RAISE EXCEPTION 'Principal must be greater than zero.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.vlb_plans WHERE id = p_new_plan_id) THEN
    RAISE EXCEPTION 'Plan not found.';
  END IF;

  SELECT * INTO old_inv
  FROM public.vlb_investments
  WHERE id = p_old_investment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investment not found.';
  END IF;

  IF old_inv.status = 'renewed' THEN
    RAISE EXCEPTION 'This investment is already renewed.';
  END IF;

  IF old_inv.status = 'settled' THEN
    RAISE EXCEPTION 'This investment is already settled.';
  END IF;

  IF old_inv.status IS DISTINCT FROM 'settlement' THEN
    RAISE EXCEPTION 'This investment is not in settlement.';
  END IF;

  IF old_inv.renewal_choice IS DISTINCT FROM 'renew' THEN
    RAISE EXCEPTION 'This investor chose to settle.';
  END IF;

  SELECT * INTO principal
  FROM public.vlb_payouts
  WHERE investment_id = p_old_investment_id
    AND type = 'principal'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Principal payout not found.';
  END IF;

  IF principal.status = 'paid' AND principal.net_pesewas > 0 THEN
    RAISE EXCEPTION 'Principal was already paid out.';
  END IF;

  UPDATE public.vlb_payouts
  SET
    gross_pesewas = 0,
    scholar_pesewas = 0,
    net_pesewas = 0,
    status = 'paid',
    notes = 'Rolled into renewal',
    paid_at = now(),
    method = NULL,
    reference = NULL
  WHERE id = principal.id;

  INSERT INTO public.vlb_investments (
    investor_id,
    plan_id,
    application_id,
    plan_snapshot,
    principal_pesewas,
    start_date,
    maturity_date,
    status,
    payment_method,
    payment_reference,
    agreement_signed_at,
    extra_rate_percent,
    stars_total,
    stars_used,
    activated_by
  )
  VALUES (
    old_inv.investor_id,
    p_new_plan_id,
    NULL,
    COALESCE(p_plan_snapshot, '{}'::jsonb),
    p_principal_pesewas,
    p_start_date,
    p_maturity_date,
    'active',
    old_inv.payment_method,
    NULL,
    old_inv.agreement_signed_at,
    0,
    COALESCE(p_stars_total, 0),
    0,
    p_renewed_by
  )
  RETURNING id INTO new_id;

  INSERT INTO public.vlb_payouts (
    investment_id,
    type,
    term_no,
    period_no,
    due_date,
    gross_pesewas,
    scholar_pesewas,
    net_pesewas,
    status
  )
  SELECT
    new_id,
    elem->>'type',
    (elem->>'term_no')::int,
    (elem->>'period_no')::int,
    (elem->>'due_date')::date,
    (elem->>'gross_pesewas')::int,
    COALESCE((elem->>'scholar_pesewas')::int, 0),
    (elem->>'net_pesewas')::int,
    'scheduled'
  FROM jsonb_array_elements(p_payouts) AS elem;

  UPDATE public.vlb_investments
  SET
    status = 'renewed',
    renewed_into_id = new_id,
    renewal_choice = 'renew',
    renewal_chosen_at = COALESCE(old_inv.renewal_chosen_at, now())
  WHERE id = p_old_investment_id;

  RETURN jsonb_build_object(
    'old_investment_id', p_old_investment_id,
    'new_investment_id', new_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.renew_vlb_investment(
  uuid, uuid, int, date, date, jsonb, jsonb, int, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_vlb_investment(
  uuid, uuid, int, date, date, jsonb, jsonb, int, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_vlb_star_redemption(
  p_investment_id uuid,
  p_product_note text,
  p_order_id uuid,
  p_recorded_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.vlb_investments%ROWTYPE;
  redemption_id uuid;
BEGIN
  IF p_product_note IS NULL OR length(trim(p_product_note)) = 0 THEN
    RAISE EXCEPTION 'Product note is required.';
  END IF;

  SELECT * INTO inv
  FROM public.vlb_investments
  WHERE id = p_investment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investment not found.';
  END IF;

  IF inv.stars_used >= inv.stars_total THEN
    RAISE EXCEPTION 'No stars remain.';
  END IF;

  INSERT INTO public.vlb_star_redemptions (
    investment_id,
    order_id,
    product_note,
    recorded_by
  )
  VALUES (
    p_investment_id,
    p_order_id,
    trim(p_product_note),
    p_recorded_by
  )
  RETURNING id INTO redemption_id;

  UPDATE public.vlb_investments
  SET stars_used = stars_used + 1
  WHERE id = p_investment_id;

  RETURN jsonb_build_object(
    'id', redemption_id,
    'stars_used', inv.stars_used + 1,
    'stars_total', inv.stars_total
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_vlb_star_redemption(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_vlb_star_redemption(uuid, text, uuid, uuid) TO service_role;

COMMIT;

SELECT
  (SELECT pg_get_functiondef(
    'public.renew_vlb_investment(uuid,uuid,int,date,date,jsonb,jsonb,int,uuid)'::regprocedure
  ) IS NOT NULL) AS renew_ok,
  (SELECT pg_get_functiondef(
    'public.record_vlb_star_redemption(uuid,text,uuid,uuid)'::regprocedure
  ) IS NOT NULL) AS stars_ok;
