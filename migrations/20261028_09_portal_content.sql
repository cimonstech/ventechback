-- Portal copy and OS-specific guides. Updates seeded rows only when
-- updated_at is still the insert timestamp (admin edits are left alone).
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

UPDATE public.content_articles
SET
  title = 'Basic laptop setup',
  summary = 'Unpack, charge, and get your laptop from VENTECH ready.',
  body_html = $g_setup$<p>When you receive your laptop from VENTECH:</p>
<ol>
<li>Remove the protective film from the screen and keyboard.</li>
<li>Connect the charger and charge to at least 50% before the first long use.</li>
<li>Press the power button. The laptop should start on its own.</li>
<li>Connect to Wi-Fi, then sign in with the account for this computer.</li>
<li>Keep the box, charger, and receipt. You will need them for warranty or service.</li>
</ol>
<p>If the laptop does not start, try another wall socket with the original charger that came with your laptop. If it still does not start, contact VENTECH support.</p>$g_setup$,
  applies_to_os = NULL,
  applies_to_condition = NULL
WHERE slug = 'ventech-laptop-setup'
  AND updated_at <= created_at + interval '2 seconds';

UPDATE public.content_articles
SET
  title = 'Windows: setup and updates',
  summary = 'Keep Windows updated and install only software you trust.',
  body_html = $g_win$<p>If this laptop runs Windows:</p>
<ul>
<li>Install updates from Settings → Windows Update. Do not skip security updates.</li>
<li>Install a browser you know (Edge is already there) and sign in only on accounts that are yours.</li>
<li>Windows Security is already turned on. You don't need to install another antivirus.</li>
<li>Do not download "free activators", cracks, or driver packs from random websites. They often install malware.</li>
<li>Create a PIN or password you can remember. Do not share it.</li>
</ul>
<p>Need Office, Adobe, or a school app? Ask VENTECH or your school for the licensed installer.</p>$g_win$,
  applies_to_os = ARRAY['windows']::text[],
  applies_to_condition = NULL
WHERE slug = 'ventech-laptop-software'
  AND updated_at <= created_at + interval '2 seconds';

UPDATE public.content_articles
SET
  title = 'Maintenance tips',
  summary = 'Keep the laptop clean, cool, and backed up.',
  body_html = $g_maint$<ul>
<li>Shut down or sleep when you are done. Do not leave it running in a closed bag.</li>
<li>Use it on a hard, flat surface so the vents can breathe. Soft beds and sofas trap heat.</li>
<li>Wipe the screen with a dry microfibre cloth. Do not spray liquid on the laptop.</li>
<li>Keep food and drinks away from the keyboard.</li>
<li>VENTECH does not recover or replace lost files. Back up your files regularly.</li>
<li>Once a month, check storage in Settings and empty the recycle or trash folder.</li>
</ul>$g_maint$,
  applies_to_os = NULL,
  applies_to_condition = NULL
WHERE slug = 'ventech-laptop-maintenance'
  AND updated_at <= created_at + interval '2 seconds';

UPDATE public.content_articles
SET
  title = 'Battery care',
  summary = 'Make the battery last longer.',
  body_html = $g_batt$<ul>
<li>Use the original charger that came with your laptop. Cheap chargers can damage the battery.</li>
<li>For daily use, charging between about 20% and 80% is gentler than always leaving it at 100%.</li>
<li>It is fine to use the laptop while it is charging.</li>
<li>Do not drain it to 0% every day.</li>
<li>If you store it for weeks, leave it around 50% and power it off.</li>
<li>Heat shortens battery life. Take it off the charger if the underside is very hot.</li>
</ul>
<p>A weaker battery after many months of use is normal. If runtime drops suddenly, contact VENTECH support.</p>$g_batt$
WHERE slug = 'ventech-laptop-battery'
  AND updated_at <= created_at + interval '2 seconds';

UPDATE public.content_articles
SET
  title = 'Hardware information',
  summary = 'Ports, charger, and what you should not open.',
  body_html = $g_hw$<p>Your laptop's exact processor, RAM, and storage are on the product page and on the invoice. On the machine:</p>
<ul>
<li>USB ports are for mice, drives, and phones. Eject or safely remove a drive before you unplug it.</li>
<li>The HDMI or USB-C video port (if present) drives a monitor or projector.</li>
<li>The charger port is only for the matching adapter. Do not force a different plug.</li>
<li>Do not open the bottom cover unless VENTECH asked you to. Opening it can void warranty.</li>
</ul>
<p>RAM or disk upgrades must be done by VENTECH or an approved technician.</p>$g_hw$
WHERE slug = 'ventech-laptop-hardware'
  AND updated_at <= created_at + interval '2 seconds';

UPDATE public.content_articles
SET
  title = 'Warranty information',
  summary = 'What VENTECH covers and how to claim.',
  body_html = $g_warr$<p>Your VENTECH warranty period is shown at the top of this page.</p>
<p>This VENTECH warranty is separate from any warranty the manufacturer may offer.</p>
<p>It covers manufacturing faults in parts and workmanship during the cover period. Unauthorised repairs can void cover.</p>
<p>For a warranty job, bring the laptop, the original charger that came with your laptop, and your receipt or order number to a VENTECH shop, or start a service request from your account.</p>
<p><a href="/warranty">Read the full Warranty Policy</a></p>$g_warr$
WHERE slug = 'ventech-laptop-warranty'
  AND updated_at <= created_at + interval '2 seconds';

UPDATE public.content_articles
SET
  title = 'Troubleshooting',
  summary = 'Fixes for common problems before you visit the shop.',
  body_html = $g_ts$<p><strong>No power.</strong> Try another wall socket. Check the charger LED if it has one. Hold the power button for 15 seconds, then try again.</p>
<p><strong>Slow or freezing.</strong> Close extra browser tabs. Restart. Check for system updates. Check that the vents are not blocked.</p>
<p><strong>No Wi-Fi.</strong> Turn Wi-Fi off and on in Settings. Forget the network and join again. Try a phone hotspot to see if the laptop or the router is the problem.</p>
<p><strong>No sound.</strong> Click the speaker icon and raise the volume. Check it is not muted. Try headphones.</p>
<p><strong>Overheating.</strong> Use a hard surface. Close heavy apps. If it shuts down from heat, let it cool, then contact support.</p>
<p>If the problem continues, request service instead of attempting repairs yourself.</p>$g_ts$,
  applies_to_os = NULL,
  applies_to_condition = NULL
WHERE slug = 'ventech-laptop-troubleshooting'
  AND updated_at <= created_at + interval '2 seconds';

INSERT INTO public.content_articles (type, title, slug, summary, body_html, status, sort_order, published_at, applies_to_os)
VALUES (
  'software',
  'macOS: setup and updates',
  'ventech-laptop-macos',
  'Keep macOS updated and install only software you trust.',
  $g_mac$<p>If this laptop runs macOS:</p>
<ul>
<li>Install updates from System Settings → General → Software Update. Do not skip security updates.</li>
<li>Sign in with your Apple ID on this computer only.</li>
<li>Do not download cracks, activators, or driver packs from random websites.</li>
<li>Use a password or Touch ID you can remember. Do not share it.</li>
</ul>
<p>Need Office, Adobe, or a school app? Ask VENTECH or your school for the licensed installer.</p>$g_mac$,
  'published',
  0,
  now(),
  ARRAY['macos']::text[]
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.content_articles (type, title, slug, summary, body_html, status, sort_order, published_at, applies_to_os)
VALUES (
  'software',
  'ChromeOS: setup and updates',
  'ventech-laptop-chromeos',
  'Keep ChromeOS updated and sign in with your Google account.',
  $g_cr$<p>If this laptop runs ChromeOS:</p>
<ul>
<li>Connect to Wi-Fi, then sign in with your Google account.</li>
<li>Check for updates in Settings → About ChromeOS. Restart if asked.</li>
<li>Do not install extensions or apps from sites you do not trust.</li>
<li>Use a PIN or password you can remember. Do not share it.</li>
</ul>$g_cr$,
  'published',
  0,
  now(),
  ARRAY['chromeos']::text[]
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.content_articles (type, title, slug, summary, body_html, status, sort_order, published_at, applies_to_condition)
VALUES (
  'user_guide',
  'About your refurbished laptop',
  'ventech-laptop-refurbished',
  'What to expect from a tested and prepared unit.',
  $g_ref$<p>This laptop was tested and prepared by VENTECH before it was sold to you.</p>
<ul>
<li>It may show light signs of earlier use. That is normal for a refurbished or used unit.</li>
<li>Battery capacity may be lower than a new laptop of the same model.</li>
<li>The warranty period for this unit is shown at the top of this page.</li>
<li>This VENTECH warranty is separate from any warranty the manufacturer may offer.</li>
</ul>
<p>If something does not work as described at handover, contact VENTECH support or request service from this page.</p>$g_ref$,
  'published',
  0,
  now(),
  ARRAY['refurbished', 'used']::text[]
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.content_targets (article_id, target_type, target_id)
SELECT a.id, 'all', NULL
FROM public.content_articles a
WHERE a.slug IN (
  'ventech-laptop-macos',
  'ventech-laptop-chromeos',
  'ventech-laptop-refurbished'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.content_targets t
  WHERE t.article_id = a.id
    AND t.target_type = 'all'
    AND t.target_id IS NULL
);

UPDATE public.faqs f
SET answer_html = q.answer_html
FROM (
  VALUES
    ('How do I open my laptop portal?', $f1$<p>Scan the QR sticker on the laptop, or open My devices in your VENTECH account and open the laptop portal. You will see setup, care, warranty, and support on that page.</p>$f1$),
    ('Why is there no serial number yet?', $f2$<p>VENTECH adds the serial when the laptop is packed or handed over. Setup guides, FAQs, and support are available immediately. Serial, warranty dates, and the QR card appear once the laptop is registered.</p>$f2$),
    ('When does my warranty start?', $f3$<p>For most orders, warranty starts on the purchase date recorded on your order. If this laptop was a pre-order, warranty starts when it is delivered. The end date is shown on this page after the serial is registered. Keep your receipt.</p>$f3$),
    ('How do I get the laptop repaired?', $f4$<p>Use Request service on this page or in your account, including while the laptop is still being prepared. You can also call or WhatsApp VENTECH support. Bring the charger and proof of purchase.</p>$f4$),
    ('Do I need to buy Windows?', $f5$<p>Most laptops from VENTECH already include an operating system. Open the setup guide on this page for the steps for your model. You do not need to buy a separate licence unless VENTECH told you otherwise.</p>$f5$)
) AS q(question, answer_html)
WHERE f.question = q.question
  AND f.updated_at <= f.created_at + interval '2 seconds'
  AND f.category_id IN (SELECT id FROM public.faq_categories WHERE slug = 'your-laptop');

COMMIT;
