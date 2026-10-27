-- Creates a withdrawal and the matching withdrawal_reserved ledger line together.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

CREATE OR REPLACE FUNCTION public.request_affiliate_withdrawal(
  p_affiliate_id uuid,
  p_amount_pesewas int,
  p_min_pesewas int,
  p_hold_hours int,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  aff public.affiliates%ROWTYPE;
  available int;
  withdrawal_id uuid;
  ledger_id uuid;
  snapshot jsonb;
BEGIN
  SELECT * INTO aff
  FROM public.affiliates
  WHERE id = p_affiliate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Affiliate not found.';
  END IF;

  IF aff.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Affiliate is not active.';
  END IF;

  IF p_amount_pesewas IS NULL OR p_amount_pesewas <= 0 THEN
    RAISE EXCEPTION 'Enter a valid withdrawal amount.';
  END IF;

  IF p_amount_pesewas < COALESCE(p_min_pesewas, 0) THEN
    RAISE EXCEPTION 'Amount is below the minimum withdrawal.';
  END IF;

  IF aff.payout_method IS NULL
     OR (aff.payout_method = 'momo' AND COALESCE(aff.momo_number, '') = '')
     OR (aff.payout_method = 'bank' AND COALESCE(aff.bank_account_number, '') = '') THEN
    RAISE EXCEPTION 'Payout details are not set.';
  END IF;

  IF aff.payout_details_changed_at IS NOT NULL
     AND aff.payout_details_changed_at + make_interval(hours => GREATEST(COALESCE(p_hold_hours, 0), 0)) > now() THEN
    RAISE EXCEPTION 'Payout details were changed recently.';
  END IF;

  SELECT COALESCE(SUM(amount_pesewas), 0)
  INTO available
  FROM public.affiliate_ledger
  WHERE affiliate_id = p_affiliate_id;

  IF available < p_amount_pesewas THEN
    RAISE EXCEPTION 'Insufficient available balance.';
  END IF;

  snapshot := jsonb_build_object(
    'payout_method', aff.payout_method,
    'momo_network', aff.momo_network,
    'momo_number', aff.momo_number,
    'bank_name', aff.bank_name,
    'bank_account_name', aff.bank_account_name,
    'bank_account_number', aff.bank_account_number,
    'withdrawal_mode', aff.withdrawal_mode
  );

  INSERT INTO public.affiliate_withdrawals (
    affiliate_id,
    amount_pesewas,
    mode,
    status,
    payout_snapshot
  ) VALUES (
    p_affiliate_id,
    p_amount_pesewas,
    aff.withdrawal_mode,
    'requested',
    snapshot
  )
  RETURNING id INTO withdrawal_id;

  INSERT INTO public.affiliate_ledger (
    affiliate_id,
    type,
    amount_pesewas,
    withdrawal_id,
    note,
    created_by
  ) VALUES (
    p_affiliate_id,
    'withdrawal_reserved',
    -p_amount_pesewas,
    withdrawal_id,
    'Withdrawal reserved',
    p_created_by
  )
  RETURNING id INTO ledger_id;

  RETURN jsonb_build_object(
    'withdrawal_id', withdrawal_id,
    'ledger_id', ledger_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_affiliate_withdrawal(uuid, int, int, int, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_affiliate_withdrawal(uuid, int, int, int, uuid) TO service_role;

COMMIT;

SELECT pg_get_functiondef('public.request_affiliate_withdrawal(uuid,int,int,int,uuid)'::regprocedure) IS NOT NULL AS function_ok;
