-- Portal targeting: product OS/condition, article filters, FAQ audience,
-- warranty page slot, and anonymous portal events.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS operating_system text;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_operating_system_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_operating_system_check
  CHECK (operating_system IS NULL OR operating_system IN ('windows', 'macos', 'chromeos', 'linux', 'none'));

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS condition text;

UPDATE public.products
SET condition = 'new'
WHERE condition IS NULL;

ALTER TABLE public.products
  ALTER COLUMN condition SET DEFAULT 'new';

ALTER TABLE public.products
  ALTER COLUMN condition SET NOT NULL;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_condition_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_condition_check
  CHECK (condition IN ('new', 'refurbished', 'used'));

ALTER TABLE public.content_articles
  ADD COLUMN IF NOT EXISTS applies_to_os text[];

ALTER TABLE public.content_articles
  ADD COLUMN IF NOT EXISTS applies_to_condition text[];

ALTER TABLE public.content_articles
  DROP CONSTRAINT IF EXISTS content_articles_applies_to_os_check;

ALTER TABLE public.content_articles
  ADD CONSTRAINT content_articles_applies_to_os_check
  CHECK (
    applies_to_os IS NULL
    OR applies_to_os <@ ARRAY['windows', 'macos', 'chromeos', 'linux', 'none']::text[]
  );

ALTER TABLE public.content_articles
  DROP CONSTRAINT IF EXISTS content_articles_applies_to_condition_check;

ALTER TABLE public.content_articles
  ADD CONSTRAINT content_articles_applies_to_condition_check
  CHECK (
    applies_to_condition IS NULL
    OR applies_to_condition <@ ARRAY['new', 'refurbished', 'used']::text[]
  );

ALTER TABLE public.faq_categories
  ADD COLUMN IF NOT EXISTS audience text;

UPDATE public.faq_categories
SET audience = 'store'
WHERE audience IS NULL;

ALTER TABLE public.faq_categories
  ALTER COLUMN audience SET DEFAULT 'store';

ALTER TABLE public.faq_categories
  ALTER COLUMN audience SET NOT NULL;

ALTER TABLE public.faq_categories
  DROP CONSTRAINT IF EXISTS faq_categories_audience_check;

ALTER TABLE public.faq_categories
  ADD CONSTRAINT faq_categories_audience_check
  CHECK (audience IN ('store', 'device_portal', 'both'));

UPDATE public.faq_categories
SET audience = 'device_portal'
WHERE slug = 'your-laptop';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.content_pages'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%laptop-banking-terms%'
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
    'laptop-banking-terms',
    'warranty'
  ));

INSERT INTO public.content_pages (slug, title, body_html, status)
VALUES ('warranty', 'Warranty Policy', '', 'draft')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.devices
  ALTER COLUMN warranty_start DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.portal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL CHECK (event IN (
    'scan',
    'claim_start',
    'claim_complete',
    'guide_open',
    'faq_open',
    'service_start'
  )),
  device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  article_id uuid,
  session_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_events_event_created_at_idx
  ON public.portal_events (event, created_at);

ALTER TABLE public.portal_events ENABLE ROW LEVEL SECURITY;

COMMIT;
