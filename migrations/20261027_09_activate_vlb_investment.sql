-- Activates a Laptop Banking application: investor, role, investment, payouts, application status.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

CREATE OR REPLACE FUNCTION public.activate_vlb_investment(
  p_application_id uuid,
  p_user_id uuid,
  p_plan_id uuid,
  p_principal_pesewas int,
  p_start_date date,
  p_maturity_date date,
  p_plan_snapshot jsonb,
  p_payouts jsonb,
  p_payment_method text,
  p_payment_reference text,
  p_agreement_signed_at date,
  p_stars_total int,
  p_activated_by uuid,
  p_allow_principal_override boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app public.vlb_applications%ROWTYPE;
  plan public.vlb_plans%ROWTYPE;
  investor public.investors%ROWTYPE;
  investment_id uuid;
  investor_no text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found.';
  END IF;

  IF p_payouts IS NULL OR jsonb_typeof(p_payouts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_payouts) < 1 THEN
    RAISE EXCEPTION 'Payout schedule is missing.';
  END IF;

  IF p_principal_pesewas IS NULL OR p_principal_pesewas <= 0 THEN
    RAISE EXCEPTION 'Principal must match the plan amount.';
  END IF;

  SELECT * INTO app
  FROM public.vlb_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found.';
  END IF;

  IF app.status = 'activated' THEN
    RAISE EXCEPTION 'This application is already activated.';
  END IF;

  IF app.status = 'declined' THEN
    RAISE EXCEPTION 'This application was declined.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vlb_investments WHERE application_id = p_application_id
  ) THEN
    RAISE EXCEPTION 'This application is already activated.';
  END IF;

  SELECT * INTO plan
  FROM public.vlb_plans
  WHERE id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found.';
  END IF;

  IF COALESCE(p_allow_principal_override, false) IS NOT TRUE
     AND p_principal_pesewas IS DISTINCT FROM plan.principal_pesewas THEN
    RAISE EXCEPTION 'Principal must match the plan amount.';
  END IF;

  BEGIN
    SELECT * INTO investor
    FROM public.investors
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.investors (user_id, investor_no)
      VALUES (p_user_id, public.next_investor_no())
      RETURNING * INTO investor;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO investor
    FROM public.investors
    WHERE user_id = p_user_id
    FOR UPDATE;
  END;

  investor_no := investor.investor_no;

  INSERT INTO public.user_roles (user_id, role, status, granted_at, granted_by)
  VALUES (p_user_id, 'investor', 'active', now(), p_activated_by)
  ON CONFLICT (user_id, role) DO UPDATE
  SET
    status = 'active',
    granted_at = now(),
    granted_by = COALESCE(EXCLUDED.granted_by, public.user_roles.granted_by);

  INSERT INTO public.vlb_investments (
    investor_id,
    plan_id,
    application_id,
    plan_snapshot,
    principal_pesewas,
    start_date,
    maturity_date,
    status,
    payment_reference,
    payment_method,
    agreement_signed_at,
    extra_rate_percent,
    stars_total,
    stars_used,
    activated_by
  )
  VALUES (
    investor.id,
    p_plan_id,
    p_application_id,
    COALESCE(p_plan_snapshot, '{}'::jsonb),
    p_principal_pesewas,
    p_start_date,
    p_maturity_date,
    'active',
    p_payment_reference,
    p_payment_method,
    p_agreement_signed_at,
    0,
    COALESCE(p_stars_total, plan.premium_stars),
    0,
    p_activated_by
  )
  RETURNING id INTO investment_id;

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
    investment_id,
    elem->>'type',
    (elem->>'term_no')::int,
    (elem->>'period_no')::int,
    (elem->>'due_date')::date,
    (elem->>'gross_pesewas')::int,
    COALESCE((elem->>'scholar_pesewas')::int, 0),
    (elem->>'net_pesewas')::int,
    'scheduled'
  FROM jsonb_array_elements(p_payouts) AS elem;

  UPDATE public.vlb_applications
  SET
    status = 'activated',
    handled_by = p_activated_by,
    plan_id = p_plan_id
  WHERE id = p_application_id;

  RETURN jsonb_build_object(
    'investment_id', investment_id,
    'investor_id', investor.id,
    'investor_no', investor_no,
    'application_id', p_application_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_vlb_investment(
  uuid, uuid, uuid, int, date, date, jsonb, jsonb, text, text, date, int, uuid, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_vlb_investment(
  uuid, uuid, uuid, int, date, date, jsonb, jsonb, text, text, date, int, uuid, boolean
) TO service_role;

COMMIT;

SELECT pg_get_functiondef(
  'public.activate_vlb_investment(uuid,uuid,uuid,int,date,date,jsonb,jsonb,text,text,date,int,uuid,boolean)'::regprocedure
) IS NOT NULL AS function_ok;
