-- Update seeded Laptop Banking FAQ answers to V3.0 wording.
-- Only rows the admin has not edited (updated_at equals created_at) are changed.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

DO $notice$
DECLARE
  skipped record;
BEGIN
  FOR skipped IN
    SELECT question, updated_at
    FROM public.faqs
    WHERE question IN (
      'What is VENTECH Laptop Banking?',
      'How do I start investing?',
      'Is Laptop Banking safe?',
      'What are Premium Stars?'
    )
      AND updated_at IS DISTINCT FROM created_at
  LOOP
    RAISE NOTICE 'Skipped edited FAQ: % (updated_at=%)', skipped.question, skipped.updated_at;
  END LOOP;
END
$notice$;

UPDATE public.faqs
SET answer_html = $a$<p>Laptop Banking is our investment program. You finance VENTECH's laptop trade and receive returns according to the current plans on the <a href="/laptop-banking">Laptop Banking page</a>. Your capital is used to bulk-purchase laptops for resale.</p>$a$
WHERE question = 'What is VENTECH Laptop Banking?'
  AND updated_at = created_at;

UPDATE public.faqs
SET answer_html = $a$<p>Visit our <a href="/laptop-banking">Laptop Banking page</a>, choose a current plan, fill out the application form, and our team will contact you with the investment agreement.</p>$a$
WHERE question = 'How do I start investing?'
  AND updated_at = created_at;

UPDATE public.faqs
SET answer_html = $a$<p>Your investment is backed by real inventory and trade. Returns follow the current plan terms and are subject to market conditions. This is a private, trade-backed agreement, not a bank deposit.</p>$a$
WHERE question = 'Is Laptop Banking safe?'
  AND updated_at = created_at;

UPDATE public.faqs
SET answer_html = $a$<p>Some plans include Premium Stars, which let investors buy gadgets at supplier pricing. Whether a plan includes stars, and how many, is shown on the <a href="/laptop-banking">Laptop Banking page</a>.</p>$a$
WHERE question = 'What are Premium Stars?'
  AND updated_at = created_at;

COMMIT;
