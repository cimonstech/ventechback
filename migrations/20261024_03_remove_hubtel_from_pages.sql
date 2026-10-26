BEGIN;

UPDATE public.content_pages
SET body_html = replace(
      body_html,
      'processed securely through our payment partners (Hubtel/Paystack).',
      'processed securely through Paystack.'
    ),
    version = version + 1
WHERE slug = 'terms'
  AND body_html LIKE '%(Hubtel/Paystack)%';

UPDATE public.content_pages
SET body_html = replace(
      body_html,
      '<li><strong>Payment Processing:</strong> Hubtel, Paystack (payment gateways)</li>',
      '<li><strong>Payment Processing:</strong> Paystack (payment gateway)</li>'
    ),
    version = version + 1
WHERE slug = 'privacy'
  AND body_html LIKE '%Hubtel, Paystack (payment gateways)%';

COMMIT;
