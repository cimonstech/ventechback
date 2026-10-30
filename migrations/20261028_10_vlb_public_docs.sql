-- Add a public Laptop Banking guide slot next to the blank agreement template.
-- Both kinds stay investor_id NULL. Do not run this file from the app.
-- Apply it in the database SQL editor.

BEGIN;

ALTER TABLE public.vlb_documents
  DROP CONSTRAINT IF EXISTS vlb_documents_kind_check;

ALTER TABLE public.vlb_documents
  ADD CONSTRAINT vlb_documents_kind_check
  CHECK (kind IN ('agreement', 'agreement_template', 'guide', 'receipt', 'statement', 'other'));

ALTER TABLE public.vlb_documents
  DROP CONSTRAINT IF EXISTS vlb_documents_template_investor_check;

ALTER TABLE public.vlb_documents
  ADD CONSTRAINT vlb_documents_template_investor_check
  CHECK (
    (kind IN ('guide', 'agreement_template') AND investor_id IS NULL)
    OR (kind NOT IN ('guide', 'agreement_template') AND investor_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS vlb_documents_one_guide_idx
  ON public.vlb_documents (kind)
  WHERE kind = 'guide';

COMMIT;
