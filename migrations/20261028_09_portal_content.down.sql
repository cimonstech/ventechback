-- Reverse OS-specific portal guides. Seeded rows an admin has edited are left alone.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

DELETE FROM public.content_targets
WHERE article_id IN (
  SELECT id FROM public.content_articles
  WHERE slug IN (
    'ventech-laptop-macos',
    'ventech-laptop-chromeos',
    'ventech-laptop-refurbished'
  )
  AND updated_at <= created_at + interval '2 seconds'
);

DELETE FROM public.content_articles
WHERE slug IN (
  'ventech-laptop-macos',
  'ventech-laptop-chromeos',
  'ventech-laptop-refurbished'
)
AND updated_at <= created_at + interval '2 seconds';

UPDATE public.content_articles
SET applies_to_os = NULL
WHERE slug = 'ventech-laptop-software'
  AND updated_at <= created_at + interval '2 seconds';

COMMIT;
