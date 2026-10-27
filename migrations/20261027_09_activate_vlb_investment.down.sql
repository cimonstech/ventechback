BEGIN;
DROP FUNCTION IF EXISTS public.activate_vlb_investment(
  uuid, uuid, uuid, int, date, date, jsonb, jsonb, text, text, date, int, uuid, boolean
);
COMMIT;
