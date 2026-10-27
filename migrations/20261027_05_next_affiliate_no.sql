-- Lets the API assign VT-AFF-00001 from public.affiliate_no_seq on approval.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

CREATE OR REPLACE FUNCTION public.next_affiliate_no()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'VT-AFF-' || lpad(nextval('public.affiliate_no_seq')::text, 5, '0');
$$;

REVOKE EXECUTE ON FUNCTION public.next_affiliate_no() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_affiliate_no() TO service_role;

COMMIT;

SELECT pg_get_functiondef('public.next_affiliate_no()'::regprocedure) IS NOT NULL AS function_ok;
