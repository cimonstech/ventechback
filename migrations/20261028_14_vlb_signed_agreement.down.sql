BEGIN;

ALTER TABLE public.vlb_applications
  DROP COLUMN IF EXISTS agreement_upload_token_hash,
  DROP COLUMN IF EXISTS agreement_upload_token_expires_at;

DROP TABLE IF EXISTS public.vlb_application_files;

COMMIT;
