import { ARTICLE_TYPES, emptyGuides, type GuideArticle, type GuideGroups } from './contentGuides.service';

export type LaptopFaq = {
  id: string;
  question: string;
  answer_html: string;
};

type DefaultGuide = GuideArticle & { body_html: string };

const DEFAULT_GUIDES: Record<(typeof ARTICLE_TYPES)[number], DefaultGuide> = {
  user_guide: {
    id: 'default-user-guide',
    type: 'user_guide',
    title: 'Basic laptop setup',
    slug: 'ventech-laptop-setup',
    summary: 'Unpack, charge, and get Windows ready on your VENTECH laptop.',
    updated_at: '2026-10-28T00:00:00.000Z',
    sort_order: 0,
    target_type: 'all',
    body_html: `<p>When you receive your VENTECH laptop:</p>
<ol>
<li>Remove the protective film from the screen and keyboard.</li>
<li>Connect the charger and charge to at least 50% before the first long use.</li>
<li>Press the power button. Windows should start on its own.</li>
<li>Connect to Wi-Fi, then sign in with your Microsoft account or create a local user.</li>
<li>Run Windows Update (Settings → Windows Update) and restart if asked.</li>
<li>Keep the box, charger, and receipt. You will need them for warranty or service.</li>
</ol>
<p>If the laptop does not start, try another wall socket with the original charger. If it still does not start, contact VENTECH support.</p>`,
  },
  software: {
    id: 'default-software',
    type: 'software',
    title: 'Windows and software',
    slug: 'ventech-laptop-software',
    summary: 'Keep Windows updated and install only software you trust.',
    updated_at: '2026-10-28T00:00:00.000Z',
    sort_order: 0,
    target_type: 'all',
    body_html: `<p>Your laptop ships with genuine Windows. Use it as follows:</p>
<ul>
<li>Install updates from Settings → Windows Update. Do not skip security updates.</li>
<li>Install a browser you know (Edge is already there) and sign in only on accounts that are yours.</li>
<li>Install antivirus only if VENTECH or your workplace asked you to. Windows Security is already on.</li>
<li>Do not download "free activators", cracks, or driver packs from random websites. They often install malware.</li>
<li>Create a PIN or password you can remember. Do not share it.</li>
</ul>
<p>Need Office, Adobe, or a school app? Ask VENTECH or your school for the licensed installer.</p>`,
  },
  maintenance: {
    id: 'default-maintenance',
    type: 'maintenance',
    title: 'Maintenance tips',
    slug: 'ventech-laptop-maintenance',
    summary: 'Keep the laptop clean, cool, and backed up.',
    updated_at: '2026-10-28T00:00:00.000Z',
    sort_order: 0,
    target_type: 'all',
    body_html: `<ul>
<li>Shut down or sleep when you are done. Do not leave it running in a closed bag.</li>
<li>Use it on a hard, flat surface so the vents can breathe. Soft beds and sofas trap heat.</li>
<li>Wipe the screen with a dry microfibre cloth. Do not spray liquid on the laptop.</li>
<li>Keep food and drinks away from the keyboard.</li>
<li>Copy important files to a USB drive or cloud storage. A failed disk is not always covered as data loss.</li>
<li>Once a month, check Storage in Settings and empty the Recycle Bin.</li>
</ul>`,
  },
  battery: {
    id: 'default-battery',
    type: 'battery',
    title: 'Battery care',
    slug: 'ventech-laptop-battery',
    summary: 'Make the battery last longer.',
    updated_at: '2026-10-28T00:00:00.000Z',
    sort_order: 0,
    target_type: 'all',
    body_html: `<ul>
<li>Use the original VENTECH charger. Cheap chargers can damage the battery.</li>
<li>For daily use, charging between about 20% and 80% is gentler than always leaving it at 100%.</li>
<li>It is fine to use the laptop while it is charging.</li>
<li>Do not drain it to 0% every day.</li>
<li>If you store it for weeks, leave it around 50% and power it off.</li>
<li>Heat shortens battery life. Take it off the charger if the underside is very hot.</li>
</ul>
<p>A weaker battery after many months of use is normal. If runtime drops suddenly, contact VENTECH support.</p>`,
  },
  hardware: {
    id: 'default-hardware',
    type: 'hardware',
    title: 'Hardware information',
    slug: 'ventech-laptop-hardware',
    summary: 'Ports, charger, and what you should not open.',
    updated_at: '2026-10-28T00:00:00.000Z',
    sort_order: 0,
    target_type: 'all',
    body_html: `<p>Your laptop's exact processor, RAM, and storage are on the product page and on the invoice. On the machine:</p>
<ul>
<li>USB ports are for mice, drives, and phones. Remove devices by using "Eject" when Windows asks.</li>
<li>The HDMI or USB-C video port (if present) drives a monitor or projector.</li>
<li>The charger port is only for the matching adapter. Do not force a different plug.</li>
<li>Do not open the bottom cover unless VENTECH asked you to. Opening it can void warranty.</li>
</ul>
<p>RAM or disk upgrades must be done by VENTECH or an approved technician.</p>`,
  },
  warranty: {
    id: 'default-warranty',
    type: 'warranty',
    title: 'Warranty information',
    slug: 'ventech-laptop-warranty',
    summary: 'What VENTECH covers and how to claim.',
    updated_at: '2026-10-28T00:00:00.000Z',
    sort_order: 0,
    target_type: 'all',
    body_html: `<p>Every VENTECH laptop is sold with a limited warranty. The months and end date appear on this page after we register the serial number.</p>
<p>The warranty covers manufacturing faults in parts and workmanship during the cover period.</p>
<p>It does not cover:</p>
<ul>
<li>Cracked screens, liquid spills, or drops</li>
<li>Lost chargers or missing keys from misuse</li>
<li>Software you installed, or viruses from downloads</li>
<li>Normal battery wear over time</li>
</ul>
<p>For a warranty job, bring the laptop, the original charger, and your receipt or order number to a VENTECH shop, or start a service request from your account. Unauthorised repairs can void cover.</p>`,
  },
  troubleshooting: {
    id: 'default-troubleshooting',
    type: 'troubleshooting',
    title: 'Troubleshooting',
    slug: 'ventech-laptop-troubleshooting',
    summary: 'Fixes for common problems before you visit the shop.',
    updated_at: '2026-10-28T00:00:00.000Z',
    sort_order: 0,
    target_type: 'all',
    body_html: `<p><strong>No power.</strong> Try another wall socket. Check the charger LED if it has one. Hold the power button for 15 seconds, then try again.</p>
<p><strong>Slow or freezing.</strong> Close extra browser tabs. Restart. Run Windows Update. Check that the vents are not blocked.</p>
<p><strong>No Wi-Fi.</strong> Turn Wi-Fi off and on in Settings. Forget the network and join again. Try a phone hotspot to see if the laptop or the router is the problem.</p>
<p><strong>No sound.</strong> Click the speaker icon and raise the volume. Check it is not muted. Try headphones.</p>
<p><strong>Overheating.</strong> Use a hard surface. Close heavy apps. If it shuts down from heat, let it cool, then contact support.</p>
<p>If none of this helps, open a service request or call VENTECH. Do not keep trying random repair videos that ask you to open the case.</p>`,
  },
};

export const DEFAULT_LAPTOP_FAQS: LaptopFaq[] = [
  {
    id: 'default-faq-portal',
    question: 'How do I open my laptop portal?',
    answer_html: '<p>Scan the QR sticker on the laptop, or open My devices in your VENTECH account and open the laptop portal. You will see setup, care, warranty, and support on that page.</p>',
  },
  {
    id: 'default-faq-serial',
    question: 'Why is there no serial number yet?',
    answer_html: '<p>VENTECH adds the serial when the laptop is packed or handed over. Setup guides and support are available immediately. Serial, warranty dates, and the service button appear once the laptop is registered.</p>',
  },
  {
    id: 'default-faq-warranty',
    question: 'When does my warranty start?',
    answer_html: '<p>Warranty starts on the purchase date recorded on your order. The end date is shown on this page after the serial is registered. Keep your receipt.</p>',
  },
  {
    id: 'default-faq-service',
    question: 'How do I get the laptop repaired?',
    answer_html: '<p>From a registered laptop, use Request service on this page or in your account. You can also call or WhatsApp VENTECH support. Bring the charger and proof of purchase.</p>',
  },
  {
    id: 'default-faq-windows',
    question: 'Do I need to buy Windows?',
    answer_html: '<p>No. VENTECH laptops ship with Windows already installed. Run Windows Update after you connect to Wi-Fi.</p>',
  },
];

export function defaultGuideBySlug(slug: string): DefaultGuide | null {
  const match = Object.values(DEFAULT_GUIDES).find((guide) => guide.slug === slug);
  return match || null;
}

export function withDefaultGuides(guides: GuideGroups | null | undefined): GuideGroups {
  const merged = emptyGuides();
  for (const type of ARTICLE_TYPES) {
    const existing = guides?.[type] || [];
    merged[type] = existing.length ? existing : [{
      id: DEFAULT_GUIDES[type].id,
      type: DEFAULT_GUIDES[type].type,
      title: DEFAULT_GUIDES[type].title,
      slug: DEFAULT_GUIDES[type].slug,
      summary: DEFAULT_GUIDES[type].summary,
      updated_at: DEFAULT_GUIDES[type].updated_at,
      sort_order: DEFAULT_GUIDES[type].sort_order,
      target_type: DEFAULT_GUIDES[type].target_type,
    }];
  }
  return merged;
}

export function laptopPortalFaqs(published: LaptopFaq[] | null | undefined): LaptopFaq[] {
  if (published && published.length > 0) return published;
  return DEFAULT_LAPTOP_FAQS;
}
