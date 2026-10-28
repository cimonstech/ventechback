BEGIN;

DELETE FROM public.settings
WHERE key IN ('feature_affiliates_enabled', 'feature_vlb_v3_enabled');

COMMIT;
