-- Rolls back 20261024_02_seed_faq_and_pages.sql.
-- Deletes the seeded FAQ rows by question, and restores the four policy pages
-- to the empty drafts created by 20261024_01. Does not delete those page rows.

BEGIN;

DELETE FROM public.faqs
WHERE question IN (
  'How long does delivery take?',
  'Do you offer free delivery?',
  'Can I track my order?',
  'Can I change or cancel my order?',
  'What payment methods do you accept?',
  'Is it safe to pay online?',
  'Do you accept installment payments?',
  'What is your return policy?',
  'How do I return an item?',
  'How long do refunds take?',
  'Can I exchange a product?',
  'Are all products brand new?',
  'Do products come with warranty?',
  'What if I receive a defective product?',
  'Can I request a product not listed on your site?',
  'How do I create an account?',
  'I forgot my password. What should I do?',
  'Is my personal information secure?',
  'What is VENTECH Laptop Banking?',
  'How do I start investing?',
  'Is Laptop Banking safe?',
  'What are Premium Stars?'
);

UPDATE public.content_pages
SET body_html = '',
    status = 'draft'
WHERE slug IN ('terms', 'privacy', 'returns', 'shipping');

COMMIT;
