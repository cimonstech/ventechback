import { DEFAULT_SITE_URL, siteUrl } from './copy';
import type { EmailContact } from './types';

export const DEFAULT_EMAIL_CONTACT: EmailContact = {
  email: 'ventechgadgets@gmail.com',
  phone: '+233 55 134 4310',
  siteUrl: DEFAULT_SITE_URL,
};

let cached: { value: EmailContact; at: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export function fallbackContact(overrides?: Partial<EmailContact>): EmailContact {
  return {
    email: overrides?.email || DEFAULT_EMAIL_CONTACT.email,
    phone: overrides?.phone || DEFAULT_EMAIL_CONTACT.phone,
    siteUrl: overrides?.siteUrl || siteUrl(),
  };
}

export async function loadEmailContact(): Promise<EmailContact> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const base = fallbackContact();
  try {
    // Lazy import so template preview/tests do not require Supabase env at module load.
    const { supabaseAdmin } = await import('../utils/supabaseClient');
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('key, value')
      .in('key', ['store_phone', 'store_email']);
    if (error) {
      console.error('[email-contact]', error);
      cached = { value: base, at: Date.now() };
      return base;
    }
    const phone = data?.find((row) => row.key === 'store_phone')?.value;
    const email = data?.find((row) => row.key === 'store_email')?.value;
    const value = fallbackContact({
      phone: typeof phone === 'string' && phone.trim() ? phone.trim() : base.phone,
      email: typeof email === 'string' && email.trim() ? email.trim() : base.email,
    });
    cached = { value, at: Date.now() };
    return value;
  } catch (error) {
    console.error('[email-contact]', error);
    return base;
  }
}
