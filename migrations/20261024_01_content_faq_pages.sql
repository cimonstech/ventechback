-- Content articles, FAQ, and legal pages.
-- Reuses public.update_updated_at_column() for updated_at.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

CREATE TABLE public.content_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('user_guide', 'maintenance', 'troubleshooting', 'hardware', 'software', 'warranty')),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  summary text,
  body_html text NOT NULL DEFAULT '',
  attachment_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  sort_order int NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX content_articles_type_status_sort_order_idx
  ON public.content_articles (type, status, sort_order);

CREATE TABLE public.content_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.content_articles(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('all', 'brand', 'category', 'product')),
  target_id uuid,
  CONSTRAINT content_targets_target_id_check CHECK (
    (target_type = 'all' AND target_id IS NULL)
    OR (target_type <> 'all' AND target_id IS NOT NULL)
  ),
  CONSTRAINT content_targets_article_target_key UNIQUE NULLS NOT DISTINCT (article_id, target_type, target_id)
);

CREATE INDEX content_targets_target_type_target_id_idx
  ON public.content_targets (target_type, target_id);

CREATE TABLE public.faq_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.faq_categories(id) ON DELETE RESTRICT,
  question text NOT NULL,
  answer_html text NOT NULL,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  sort_order int NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX faqs_category_id_status_sort_order_idx
  ON public.faqs (category_id, status, sort_order);

CREATE TABLE public.content_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug IN ('terms', 'privacy', 'returns', 'shipping', 'affiliate-terms', 'laptop-banking-terms')),
  title text NOT NULL,
  body_html text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  version int NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_content_articles_updated_at
  BEFORE UPDATE ON public.content_articles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_faq_categories_updated_at
  BEFORE UPDATE ON public.faq_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_faqs_updated_at
  BEFORE UPDATE ON public.faqs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_content_pages_updated_at
  BEFORE UPDATE ON public.content_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.faq_categories (name, slug, sort_order) VALUES
  ('Orders & Shipping', 'orders-shipping', 1),
  ('Payment', 'payment', 2),
  ('Returns & Refunds', 'returns-refunds', 3),
  ('Products', 'products', 4),
  ('Account & Security', 'account-security', 5),
  ('Laptop Banking', 'laptop-banking', 6);

INSERT INTO public.content_pages (slug, title) VALUES
  ('terms', 'Terms of Service'),
  ('privacy', 'Privacy Policy'),
  ('returns', 'Returns Policy'),
  ('shipping', 'Shipping Policy'),
  ('affiliate-terms', 'Affiliate Terms'),
  ('laptop-banking-terms', 'Laptop Banking Terms');

ALTER TABLE public.content_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faq_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view published content articles"
  ON public.content_articles
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

CREATE POLICY "Public can view targets of published articles"
  ON public.content_targets
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.content_articles
      WHERE content_articles.id = content_targets.article_id
        AND content_articles.status = 'published'
    )
  );

CREATE POLICY "Public can view active faq categories"
  ON public.faq_categories
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "Public can view published faqs"
  ON public.faqs
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

CREATE POLICY "Public can view published content pages"
  ON public.content_pages
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

COMMIT;
