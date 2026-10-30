BEGIN;

DELETE FROM public.vlb_documents WHERE kind = 'guide';

DROP INDEX IF EXISTS public.vlb_documents_one_guide_idx;

ALTER TABLE public.vlb_documents
  DROP CONSTRAINT IF EXISTS vlb_documents_template_investor_check;

ALTER TABLE public.vlb_documents
  DROP CONSTRAINT IF EXISTS vlb_documents_kind_check;

ALTER TABLE public.vlb_documents
  ADD CONSTRAINT vlb_documents_kind_check
  CHECK (kind IN ('agreement', 'agreement_template', 'receipt', 'statement', 'other'));

ALTER TABLE public.vlb_documents
  ADD CONSTRAINT vlb_documents_template_investor_check
  CHECK (
    (kind = 'agreement_template' AND investor_id IS NULL)
    OR (kind <> 'agreement_template' AND investor_id IS NOT NULL)
  );

COMMIT;
