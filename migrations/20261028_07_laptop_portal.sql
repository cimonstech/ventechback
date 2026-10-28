-- Laptop customer portal: battery article type, default guides, and laptop FAQs.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

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
  CHECK (type IN ('user_guide', 'maintenance', 'troubleshooting', 'hardware', 'software', 'battery', 'warranty'));

INSERT INTO public.content_articles (type, title, slug, summary, body_html, status, sort_order, published_at)
VALUES (
  'user_guide',
  'Basic laptop setup',
  'ventech-laptop-setup',
  'Unpack, charge, and get Windows ready on your VENTECH laptop.',
  $g_setup$<p>When you receive your VENTECH laptop:</p>
<ol>
<li>Remove the protective film from the screen and keyboard.</li>
<li>Connect the charger and charge to at least 50% before the first long use.</li>
<li>Press the power button. Windows should start on its own.</li>
<li>Connect to Wi-Fi, then sign in with your Microsoft account or create a local user.</li>
<li>Run Windows Update (Settings → Windows Update) and restart if asked.</li>
<li>Keep the box, charger, and receipt. You will need them for warranty or service.</li>
</ol>
<p>If the laptop does not start, try another wall socket with the original charger. If it still does not start, contact VENTECH support.</p>$g_setup$,
  'published',
  0,
  now()
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.content_articles (type, title, slug, summary, body_html, status, sort_order, published_at)
VALUES (
  'software',
  'Windows and software',
  'ventech-laptop-software',
  'Keep Windows updated and install only software you trust.',
  $g_software$<p>Your laptop ships with genuine Windows. Use it as follows:</p>
<ul>
<li>Install updates from Settings → Windows Update. Do not skip security updates.</li>
<li>Install a browser you know (Edge is already there) and sign in only on accounts that are yours.</li>
<li>Install antivirus only if VENTECH or your workplace asked you to. Windows Security is already on.</li>
<li>Do not download "free activators", cracks, or driver packs from random websites. They often install malware.</li>
<li>Create a PIN or password you can remember. Do not share it.</li>
</ul>
<p>Need Office, Adobe, or a school app? Ask VENTECH or your school for the licensed installer.</p>$g_software$,
  'published',
  0,
  now()
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.content_articles (type, title, slug, summary, body_html, status, sort_order, published_at)
VALUES (
  'maintenance',
  'Maintenance tips',
  'ventech-laptop-maintenance',
  'Keep the laptop clean, cool, and backed up.',
  $g_maint$<ul>
<li>Shut down or sleep when you are done. Do not leave it running in a closed bag.</li>
<li>Use it on a hard, flat surface so the vents can breathe. Soft beds and sofas trap heat.</li>
<li>Wipe the screen with a dry microfibre cloth. Do not spray liquid on the laptop.</li>
<li>Keep food and drinks away from the keyboard.</li>
<li>Copy important files to a USB drive or cloud storage. A failed disk is not always covered as data loss.</li>
<li>Once a month, check Storage in Settings and empty the Recycle Bin.</li>
</ul>$g_maint$,
  'published',
  0,
  now()
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.content_articles (type, title, slug, summary, body_html, status, sort_order, published_at)
VALUES (
  'battery',
  'Battery care',
  'ventech-laptop-battery',
  'Make the battery last longer.',
  $g_batt$<ul>
<li>Use the original VENTECH charger. Cheap chargers can damage the battery.</li>
<li>For daily use, charging between about 20% and 80% is gentler than always leaving it at 100%.</li>
<li>It is fine to use the laptop while it is charging.</li>
<li>Do not drain it to 0% every day.</li>
<li>If you store it for weeks, leave it around 50% and power it off.</li>
<li>Heat shortens battery life. Take it off the charger if the underside is very hot.</li>
</ul>
<p>A weaker battery after many months of use is normal. If runtime drops suddenly, contact VENTECH support.</p>$g_batt$,
  'published',
  0,
  now()
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.content_articles (type, title, slug, summary, body_html, status, sort_order, published_at)
VALUES (
  'hardware',
  'Hardware information',
  'ventech-laptop-hardware',
  'Ports, charger, and what you should not open.',
  $g_hw$<p>Your laptop's exact processor, RAM, and storage are on the product page and on the invoice. On the machine:</p>
<ul>
<li>USB ports are for mice, drives, and phones. Remove devices by using "Eject" when Windows asks.</li>
<li>The HDMI or USB-C video port (if present) drives a monitor or projector.</li>
<li>The charger port is only for the matching adapter. Do not force a different plug.</li>
<li>Do not open the bottom cover unless VENTECH asked you to. Opening it can void warranty.</li>
</ul>
<p>RAM or disk upgrades must be done by VENTECH or an approved technician.</p>$g_hw$,
  'published',
  0,
  now()
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.content_articles (type, title, slug, summary, body_html, status, sort_order, published_at)
VALUES (
  'warranty',
  'Warranty information',
  'ventech-laptop-warranty',
  'What VENTECH covers and how to claim.',
  $g_warr$<p>Every VENTECH laptop is sold with a limited warranty. The months and end date appear on this page after we register the serial number.</p>
<p>The warranty covers manufacturing faults in parts and workmanship during the cover period.</p>
<p>It does not cover:</p>
<ul>
<li>Cracked screens, liquid spills, or drops</li>
<li>Lost chargers or missing keys from misuse</li>
<li>Software you installed, or viruses from downloads</li>
<li>Normal battery wear over time</li>
</ul>
<p>For a warranty job, bring the laptop, the original charger, and your receipt or order number to a VENTECH shop, or start a service request from your account. Unauthorised repairs can void cover.</p>$g_warr$,
  'published',
  0,
  now()
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.content_articles (type, title, slug, summary, body_html, status, sort_order, published_at)
VALUES (
  'troubleshooting',
  'Troubleshooting',
  'ventech-laptop-troubleshooting',
  'Fixes for common problems before you visit the shop.',
  $g_ts$<p><strong>No power.</strong> Try another wall socket. Check the charger LED if it has one. Hold the power button for 15 seconds, then try again.</p>
<p><strong>Slow or freezing.</strong> Close extra browser tabs. Restart. Run Windows Update. Check that the vents are not blocked.</p>
<p><strong>No Wi-Fi.</strong> Turn Wi-Fi off and on in Settings. Forget the network and join again. Try a phone hotspot to see if the laptop or the router is the problem.</p>
<p><strong>No sound.</strong> Click the speaker icon and raise the volume. Check it is not muted. Try headphones.</p>
<p><strong>Overheating.</strong> Use a hard surface. Close heavy apps. If it shuts down from heat, let it cool, then contact support.</p>
<p>If none of this helps, open a service request or call VENTECH. Do not keep trying random repair videos that ask you to open the case.</p>$g_ts$,
  'published',
  0,
  now()
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.content_targets (article_id, target_type, target_id)
SELECT a.id, 'all', NULL
FROM public.content_articles a
WHERE a.slug IN (
  'ventech-laptop-setup',
  'ventech-laptop-software',
  'ventech-laptop-maintenance',
  'ventech-laptop-battery',
  'ventech-laptop-hardware',
  'ventech-laptop-warranty',
  'ventech-laptop-troubleshooting'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.content_targets t
  WHERE t.article_id = a.id
    AND t.target_type = 'all'
    AND t.target_id IS NULL
);

INSERT INTO public.faq_categories (name, slug, sort_order, is_active)
VALUES ('Your laptop', 'your-laptop', 80, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.faqs (category_id, question, answer_html, status, sort_order)
SELECT c.id, q.question, q.answer_html, 'published', q.sort_order
FROM public.faq_categories c
CROSS JOIN (
  VALUES
    (0, 'How do I open my laptop portal?', $f1$<p>Scan the QR sticker on the laptop, or open My devices in your VENTECH account and open the laptop portal. You will see setup, care, warranty, and support on that page.</p>$f1$),
    (1, 'Why is there no serial number yet?', $f2$<p>VENTECH adds the serial when the laptop is packed or handed over. Setup guides and support are available immediately. Serial, warranty dates, and the service button appear once the laptop is registered.</p>$f2$),
    (2, 'When does my warranty start?', $f3$<p>Warranty starts on the purchase date recorded on your order. The end date is shown on this page after the serial is registered. Keep your receipt.</p>$f3$),
    (3, 'How do I get the laptop repaired?', $f4$<p>From a registered laptop, use Request service on this page or in your account. You can also call or WhatsApp VENTECH support. Bring the charger and proof of purchase.</p>$f4$),
    (4, 'Do I need to buy Windows?', $f5$<p>No. VENTECH laptops ship with Windows already installed. Run Windows Update after you connect to Wi-Fi.</p>$f5$)
) AS q(sort_order, question, answer_html)
WHERE c.slug = 'your-laptop'
  AND NOT EXISTS (
    SELECT 1
    FROM public.faqs f
    WHERE f.category_id = c.id
      AND f.question = q.question
  );

COMMIT;
