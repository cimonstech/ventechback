-- Reverse laptop portal seed and battery article type.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

DELETE FROM public.faqs
WHERE category_id IN (
  SELECT id FROM public.faq_categories WHERE slug = 'your-laptop'
)
AND question IN (
  'How do I open my laptop portal?',
  'Why is there no serial number yet?',
  'When does my warranty start?',
  'How do I get the laptop repaired?',
  'Do I need to buy Windows?'
);

DELETE FROM public.faq_categories
WHERE slug = 'your-laptop'
  AND NOT EXISTS (
    SELECT 1 FROM public.faqs WHERE category_id = faq_categories.id
  );

DELETE FROM public.content_targets
WHERE article_id IN (
  SELECT id FROM public.content_articles
  WHERE slug IN (
    'ventech-laptop-setup',
    'ventech-laptop-software',
    'ventech-laptop-maintenance',
    'ventech-laptop-battery',
    'ventech-laptop-hardware',
    'ventech-laptop-warranty',
    'ventech-laptop-troubleshooting'
  )
);

DELETE FROM public.content_articles
WHERE slug IN (
  'ventech-laptop-setup',
  'ventech-laptop-software',
  'ventech-laptop-maintenance',
  'ventech-laptop-battery',
  'ventech-laptop-hardware',
  'ventech-laptop-warranty',
  'ventech-laptop-troubleshooting'
);

UPDATE public.content_articles
SET type = 'maintenance'
WHERE type = 'battery';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.content_articles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%user_guide%'
      AND pg_get_constraintdef(oid) LIKE '%warranty%'
  LOOP
    EXECUTE format('ALTER TABLE public.content_articles DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.content_articles
  ADD CONSTRAINT content_articles_type_check
  CHECK (type IN ('user_guide', 'maintenance', 'troubleshooting', 'hardware', 'software', 'warranty'));

COMMIT;
