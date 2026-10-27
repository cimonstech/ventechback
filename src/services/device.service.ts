import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
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
} | null;

export type PublicDeviceView = {
  model_name: string;
  product: {
    slug: string | null;
    thumbnail: string | null;
  };
  warranty: WarrantyState;
};

export type OwnerDeviceView = PublicDeviceView & {
  customer_name: string | null;
  serial_number: string;
  purchase_date: string;
  order_number: string | null;
  order_id: string | null;
};

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

export function toOwnerView(
  device: {
    model_name: string;
    customer_name?: string | null;
    serial_number: string;
    purchase_date: string;
    order_id?: string | null;
  } & DeviceWarranty,
  product: ProductView,
  order: OrderView
): OwnerDeviceView {
  return {
    ...toPublicView(device, product),
    customer_name: device.customer_name ?? null,
    serial_number: device.serial_number,
    purchase_date: typeof device.purchase_date === 'string' ? device.purchase_date.slice(0, 10) : device.purchase_date,
    order_number: order?.order_number ?? null,
    order_id: order?.id ?? device.order_id ?? null,
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
