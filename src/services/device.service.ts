import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '../utils/supabaseClient';
import { emailService } from './email.service';

export type WarrantyState = {
  status: 'active' | 'expired' | 'none';
  endsOn: string | null;
};

type DeviceWarranty = {
  warranty_start?: string | null;
  warranty_months?: number | null;
};

type ProductView = {
  slug?: string | null;
  thumbnail?: string | null;
} | null;

type OrderView = {
  id?: string | null;
  order_number?: string | null;
  user_id?: string | null;
} | null;

type OwnerAccount = {
  id: string;
  email?: string | null;
  fullName?: string | null;
};

export type PublicDeviceView = {
  model_name: string;
  product: {
    slug: string | null;
    thumbnail: string | null;
  };
  warranty: WarrantyState;
};

export type OriginalOwnerView = PublicDeviceView & {
  ownership: 'original';
  customer_name: string | null;
  serial_number: string;
  purchase_date: string;
  order_number: string | null;
  order_id: string | null;
};

export type TransferredOwnerView = PublicDeviceView & {
  ownership: 'transferred';
  owner_name: string | null;
  serial_number: string;
  purchase_date: string;
  linked_at: string | null;
};

export type OwnerDeviceView = OriginalOwnerView | TransferredOwnerView;

export function generateQrToken(): string {
  return randomBytes(16).toString('base64url');
}

export function generateClaimCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashClaimCode(code: string, deviceId: string): string {
  return createHash('sha256').update(`${code}${deviceId}`).digest('hex');
}

export function claimCodesMatch(storedHash: string, code: string, deviceId: string): boolean {
  const incoming = hashClaimCode(code, deviceId);
  if (!/^[a-f0-9]{64}$/i.test(storedHash) || !/^[a-f0-9]{64}$/i.test(incoming)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(incoming, 'hex'));
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '****';
  if (local.length === 1) return `${local[0]}****@${domain}`;
  return `${local[0]}****${local[local.length - 1]}@${domain}`;
}

function trimmed(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function metadataName(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '';
  const record = meta as Record<string, unknown>;
  return trimmed(record.full_name) || trimmed(record.name);
}

export async function ownerDisplayName(
  user: {
    id?: string | null;
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null | undefined,
  options: { maskEmail: boolean }
): Promise<string> {
  const fullName = trimmed(user?.full_name);
  if (fullName) return fullName;

  const combined = [trimmed(user?.first_name), trimmed(user?.last_name)].filter(Boolean).join(' ').trim();
  if (combined) return combined;

  if (user?.id) {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(user.id);
      if (error) {
        console.error('owner display name auth lookup', error);
      } else {
        const authUser = data?.user as { user_metadata?: unknown; raw_user_meta_data?: unknown } | undefined;
        const fromAuth = metadataName(authUser?.raw_user_meta_data) || metadataName(authUser?.user_metadata);
        if (fromAuth) return fromAuth;
      }
    } catch (error) {
      console.error('owner display name auth lookup', error);
    }
  }

  const email = trimmed(user?.email);
  if (!email) return '';
  return options.maskEmail ? maskEmail(email) : email;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function addMonths(isoDate: string, months: number): string | null {
  if (!isIsoDate(isoDate)) return null;
  const [year, month, day] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, day));
  const expectedMonth = ((month - 1 + months) % 12 + 12) % 12;
  if (shifted.getUTCMonth() !== expectedMonth) {
    return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 0)).toISOString().slice(0, 10);
  }
  return shifted.toISOString().slice(0, 10);
}

export function warrantyStatus(device: DeviceWarranty): WarrantyState {
  const months = Number(device.warranty_months ?? 0);
  const start = typeof device.warranty_start === 'string' ? device.warranty_start.slice(0, 10) : '';
  if (!Number.isInteger(months) || months <= 0 || !isIsoDate(start)) {
    return { status: 'none', endsOn: null };
  }

  const endsOn = addMonths(start, months);
  if (!endsOn) return { status: 'none', endsOn: null };

  const today = new Date().toISOString().slice(0, 10);
  return {
    status: today <= endsOn ? 'active' : 'expired',
    endsOn,
  };
}

export function toPublicView(
  device: { model_name: string } & DeviceWarranty,
  product: ProductView
): PublicDeviceView {
  return {
    model_name: device.model_name,
    product: {
      slug: product?.slug ?? null,
      thumbnail: product?.thumbnail ?? null,
    },
    warranty: warrantyStatus(device),
  };
}

function emailsMatch(left?: string | null, right?: string | null): boolean {
  const a = (left || '').trim().toLowerCase();
  const b = (right || '').trim().toLowerCase();
  return Boolean(a && b && a === b);
}

export function isOriginalBuyer(
  device: { customer_email?: string | null },
  order: { user_id?: string | null } | null,
  owner: { id: string; email?: string | null }
): boolean {
  if (order?.user_id && order.user_id === owner.id) return true;
  return emailsMatch(owner.email, device.customer_email);
}

function purchaseDateOf(value: string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value;
}

export function toOwnerView(
  device: {
    model_name: string;
    customer_name?: string | null;
    customer_email?: string | null;
    serial_number: string;
    purchase_date: string;
    order_id?: string | null;
    owner_linked_at?: string | null;
  } & DeviceWarranty,
  product: ProductView,
  order: OrderView,
  owner: OwnerAccount
): OwnerDeviceView {
  const shared = {
    ...toPublicView(device, product),
    serial_number: device.serial_number,
    purchase_date: purchaseDateOf(device.purchase_date),
  };

  if (isOriginalBuyer(device, order, owner)) {
    return {
      ...shared,
      ownership: 'original',
      customer_name: device.customer_name ?? null,
      order_number: order?.order_number ?? null,
      order_id: order?.id ?? device.order_id ?? null,
    };
  }

  return {
    ...shared,
    ownership: 'transferred',
    owner_name: owner.fullName || null,
    linked_at: device.owner_linked_at ?? null,
  };
}

function siteOrigin(): string | null {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || '').trim().replace(/\/$/, '');
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendDeviceRegistrationEmail(input: {
  to: string;
  customerName: string | null;
  devices: Array<{ model_name: string; qr_token: string }>;
}): Promise<void> {
  const site = siteOrigin();
  if (!site) {
    console.error('Device registration email skipped: NEXT_PUBLIC_SITE_URL or SITE_URL is not set');
    return;
  }

  if (!input.to) {
    console.error('Device registration email skipped: order has no customer email');
    return;
  }

  const items = input.devices.map((device) => {
    const url = `${site}/d/${encodeURIComponent(device.qr_token)}`;
    return `<p style="margin:0 0 8px;font-size:16px;"><strong>${escapeHtml(device.model_name)}</strong></p>
      <p style="margin:0 0 24px;"><a href="${url}" style="display:inline-block;background:#FF7A19;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">View your laptop</a></p>`;
  }).join('');

  const html = `<div style="font-family:Arial,sans-serif;color:#1A1A1A;max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="font-size:22px;margin:0 0 16px;">Your VENTECH laptop is registered</h1>
    <p>Hi ${escapeHtml(input.customerName || 'there')},</p>
    <p>Your laptop is now registered with VENTECH.</p>
    ${items}
  </div>`;

  try {
    const sent = await emailService.sendEmail({
      to: input.to,
      subject: 'Your VENTECH laptop is registered',
      html,
    });
    if (!sent) {
      console.error('Device registration email was not sent');
    }
  } catch (error) {
    console.error('Device registration email failed:', error);
  }
}

export async function sendOwnerLinkedEmail(input: {
  to: string;
  modelName: string;
  qrToken: string;
}): Promise<void> {
  const site = siteOrigin();
  if (!site) {
    console.error('Owner linked email skipped: NEXT_PUBLIC_SITE_URL or SITE_URL is not set');
    return;
  }
  if (!input.to) {
    console.error('Owner linked email skipped: new owner has no email');
    return;
  }

  const url = `${site}/d/${encodeURIComponent(input.qrToken)}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#1A1A1A;max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="font-size:22px;margin:0 0 16px;">A VENTECH laptop has been added to your account</h1>
    <p style="margin:0 0 8px;font-size:16px;"><strong>${escapeHtml(input.modelName)}</strong></p>
    <p style="margin:0 0 24px;"><a href="${url}" style="display:inline-block;background:#FF7A19;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">View your laptop</a></p>
  </div>`;

  try {
    const sent = await emailService.sendEmail({
      to: input.to,
      subject: 'A VENTECH laptop has been added to your account',
      html,
    });
    if (!sent) {
      console.error('Owner linked email was not sent');
    }
  } catch (error) {
    console.error('Owner linked email failed:', error);
  }
}

export async function sendClaimCodeEmail(to: string, code: string): Promise<boolean> {
  const html = `<div style="font-family:Arial,sans-serif;color:#1A1A1A;max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="font-size:22px;margin:0 0 16px;">Your VENTECH claim code</h1>
    <p>Use this code to add the laptop to your VENTECH account. It expires in 10 minutes.</p>
    <p style="font-size:32px;letter-spacing:6px;font-weight:700;margin:24px 0;">${escapeHtml(code)}</p>
    <p>If you did not request this, you can ignore this email.</p>
  </div>`;

  return emailService.sendEmail({
    to,
    subject: 'Your VENTECH claim code',
    html,
  });
}
