-- Allow a blank Laptop Banking agreement template (not tied to an investor)
-- and keep investor_id required for every other document kind.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

ALTER TABLE public.vlb_documents
  ALTER COLUMN investor_id DROP NOT NULL;

ALTER TABLE public.vlb_documents
  DROP CONSTRAINT IF EXISTS vlb_documents_kind_check;

ALTER TABLE public.vlb_documents
  ADD CONSTRAINT vlb_documents_kind_check
  CHECK (kind IN ('agreement', 'agreement_template', 'receipt', 'statement', 'other'));

ALTER TABLE public.vlb_documents
  DROP CONSTRAINT IF EXISTS vlb_documents_template_investor_check;

ALTER TABLE public.vlb_documents
  ADD CONSTRAINT vlb_documents_template_investor_check
  CHECK (
    (kind = 'agreement_template' AND investor_id IS NULL)
    OR (kind <> 'agreement_template' AND investor_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS vlb_documents_one_template_idx
  ON public.vlb_documents (kind)
  WHERE kind = 'agreement_template';

COMMIT;
