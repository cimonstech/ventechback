-- Undo admin customer list functions.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_list_customers(text, text, text, text, timestamptz, timestamptz, text, integer, integer);
DROP FUNCTION IF EXISTS public.admin_customer_type_counts(text, timestamptz, timestamptz);

COMMIT;
