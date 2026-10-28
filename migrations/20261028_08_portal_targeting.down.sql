-- Reverse portal targeting columns, warranty page slot, and portal_events.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

DROP TABLE IF EXISTS public.portal_events;

UPDATE public.devices
SET warranty_start = purchase_date
WHERE warranty_start IS NULL;

ALTER TABLE public.devices
  ALTER COLUMN warranty_start SET NOT NULL;

DELETE FROM public.content_pages
WHERE slug = 'warranty';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.content_pages'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%warranty%'
  LOOP
    EXECUTE format('ALTER TABLE public.content_pages DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.content_pages
  ADD CONSTRAINT content_pages_slug_check
  CHECK (slug IN (
    'terms',
    'privacy',
    'returns',
    'shipping',
    'affiliate-terms',
    'laptop-banking-terms'
  ));

ALTER TABLE public.faq_categories
  DROP CONSTRAINT IF EXISTS faq_categories_audience_check;

ALTER TABLE public.faq_categories
  DROP COLUMN IF EXISTS audience;

ALTER TABLE public.content_articles
  DROP CONSTRAINT IF EXISTS content_articles_applies_to_os_check;

ALTER TABLE public.content_articles
  DROP CONSTRAINT IF EXISTS content_articles_applies_to_condition_check;

ALTER TABLE public.content_articles
  DROP COLUMN IF EXISTS applies_to_os;

ALTER TABLE public.content_articles
  DROP COLUMN IF EXISTS applies_to_condition;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_operating_system_check;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_condition_check;

ALTER TABLE public.products
  DROP COLUMN IF EXISTS operating_system;

ALTER TABLE public.products
  DROP COLUMN IF EXISTS condition;

COMMIT;
