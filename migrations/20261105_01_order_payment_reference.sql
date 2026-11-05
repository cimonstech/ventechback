-- One Paystack payment cannot create two orders of the same type
-- (regular vs pre-order). Mixed carts still create exactly two rows.
-- Do not run this file from the app. Apply it in the database SQL editor.
--
-- Run this duplicate check on production BEFORE applying (uses JSON, no new column):
--
-- SELECT
--   shipping_address->>'payment_reference' AS payment_reference,
--   COALESCE(shipping_address->>'is_pre_order', 'false') IN ('true', 't', '1') AS is_pre_order,
--   COUNT(*) AS n,
--   string_agg(order_number, ', ' ORDER BY created_at) AS order_numbers,
--   string_agg(id::text, ', ' ORDER BY created_at) AS ids
-- FROM public.orders
-- WHERE NULLIF(btrim(shipping_address->>'payment_reference'), '') IS NOT NULL
-- GROUP BY 1, 2
-- HAVING COUNT(*) > 1;
--
-- SELECT
--   paystack_reference,
--   COUNT(*) AS n,
--   string_agg(id::text, ', ' ORDER BY created_at) AS ids
-- FROM public.transactions
-- WHERE NULLIF(btrim(paystack_reference), '') IS NOT NULL
-- GROUP BY 1
-- HAVING COUNT(*) > 1;

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_reference text;

UPDATE public.orders
SET payment_reference = NULLIF(btrim(shipping_address->>'payment_reference'), '')
WHERE payment_reference IS NULL
  AND NULLIF(btrim(shipping_address->>'payment_reference'), '') IS NOT NULL;

DO $$
DECLARE
  dup text;
  order_n bigint;
BEGIN
  SELECT string_agg(
    format(
      '%s (%s) x%s [%s]',
      payment_reference,
      CASE WHEN is_pre_order THEN 'pre-order' ELSE 'regular' END,
      n,
      order_numbers
    ),
    '; '
  )
  INTO dup
  FROM (
    SELECT
      payment_reference,
      COALESCE(shipping_address->>'is_pre_order', 'false') IN ('true', 't', '1') AS is_pre_order,
      COUNT(*) AS n,
      string_agg(order_number, ', ' ORDER BY created_at) AS order_numbers
    FROM public.orders
    WHERE payment_reference IS NOT NULL
    GROUP BY 1, 2
    HAVING COUNT(*) > 1
  ) d;

  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate Paystack orders exist; resolve them before this unique index. %', dup;
  END IF;

  SELECT COUNT(*) INTO order_n FROM public.orders;
  RAISE NOTICE 'orders row count before unique index (writes blocked briefly): %', order_n;
END
$$;

CREATE UNIQUE INDEX orders_payment_reference_preorder_uidx
  ON public.orders (
    payment_reference,
    (COALESCE(shipping_address->>'is_pre_order', 'false') IN ('true', 't', '1'))
  )
  WHERE payment_reference IS NOT NULL;

DO $$
DECLARE
  dup text;
  txn_n bigint;
BEGIN
  SELECT string_agg(
    format('%s x%s [%s]', paystack_reference, n, ids),
    '; '
  )
  INTO dup
  FROM (
    SELECT
      paystack_reference,
      COUNT(*) AS n,
      string_agg(id::text, ', ' ORDER BY created_at) AS ids
    FROM public.transactions
    WHERE NULLIF(btrim(paystack_reference), '') IS NOT NULL
    GROUP BY 1
    HAVING COUNT(*) > 1
  ) d;

  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate Paystack transactions exist; resolve them before this unique index. %', dup;
  END IF;

  SELECT COUNT(*) INTO txn_n FROM public.transactions;
  RAISE NOTICE 'transactions row count before unique index (writes blocked briefly): %', txn_n;
END
$$;

CREATE UNIQUE INDEX transactions_paystack_reference_uidx
  ON public.transactions (paystack_reference)
  WHERE NULLIF(btrim(paystack_reference), '') IS NOT NULL;

COMMIT;
