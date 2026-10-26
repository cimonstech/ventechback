-- Rolls back 20261024_01_content_faq_pages.sql.
-- Drops only the five content and FAQ tables, children first.

BEGIN;

DROP TABLE public.content_targets;
DROP TABLE public.faqs;
DROP TABLE public.content_articles;
DROP TABLE public.faq_categories;
DROP TABLE public.content_pages;

COMMIT;
