BEGIN;
DROP FUNCTION IF EXISTS public.record_vlb_star_redemption(uuid, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.renew_vlb_investment(
  uuid, uuid, int, date, date, jsonb, jsonb, int, uuid
);
COMMIT;
