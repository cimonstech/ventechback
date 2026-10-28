BEGIN;

DELETE FROM public.vlb_documents WHERE kind = 'agreement_template';

DROP INDEX IF EXISTS public.vlb_documents_one_template_idx;

ALTER TABLE public.vlb_documents
  DROP CONSTRAINT IF EXISTS vlb_documents_template_investor_check;

ALTER TABLE public.vlb_documents
  DROP CONSTRAINT IF EXISTS vlb_documents_kind_check;

ALTER TABLE public.vlb_documents
  ALTER COLUMN investor_id SET NOT NULL;

ALTER TABLE public.vlb_documents
  ADD CONSTRAINT vlb_documents_kind_check
  CHECK (kind IN ('agreement', 'receipt', 'statement', 'other'));

COMMIT;
