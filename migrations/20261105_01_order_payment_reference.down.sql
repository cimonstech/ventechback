-- Undo payment_reference uniqueness.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

DROP INDEX IF EXISTS public.transactions_paystack_reference_uidx;
DROP INDEX IF EXISTS public.orders_payment_reference_preorder_uidx;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS payment_reference;

COMMIT;
