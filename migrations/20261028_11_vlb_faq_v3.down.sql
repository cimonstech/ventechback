-- Restore the pre-V3.0 Laptop Banking FAQ answers only where this migration's
-- wording is still in place. Do not run this file from the app.

BEGIN;

UPDATE public.faqs
SET answer_html = $a$<p>Laptop Banking is our investment program where you invest in our laptop trade business and earn monthly returns of 8-9% over 6 months. Your investment helps us bulk-purchase laptops for resale.</p>$a$
WHERE question = 'What is VENTECH Laptop Banking?'
  AND answer_html LIKE '%current plans on the%Laptop Banking page%';

UPDATE public.faqs
SET answer_html = $a$<p>Visit our <a href="/laptop-banking">Laptop Banking page</a>, choose your investment tier (starting from GHS 2,500), fill out the application form, and our team will contact you with the investment agreement.</p>$a$
WHERE question = 'How do I start investing?'
  AND answer_html LIKE '%choose a current plan%';

UPDATE public.faqs
SET answer_html = $a$<p>Your investment is backed by real inventory and trade. We provide monthly returns with proof of payment. However, like any investment, returns are subject to market conditions.</p>$a$
WHERE question = 'Is Laptop Banking safe?'
  AND answer_html LIKE '%not a bank deposit%';

UPDATE public.faqs
SET answer_html = $a$<p>Premium Stars allow investors to purchase up to 5 gadgets at supplier pricing (below retail). You get 5 stars with every investment, redeemable within your 6-month investment period.</p>$a$
WHERE question = 'What are Premium Stars?'
  AND answer_html LIKE '%Whether a plan includes stars%';

COMMIT;
