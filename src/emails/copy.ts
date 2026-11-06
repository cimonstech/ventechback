import { formatCedis, formatPesewas } from '../utils/money';

const ACCRA = 'Africa/Accra';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const LOGO_URL = 'https://files.ventechgadgets.com/ventech_logo_1.png';

export const DEFAULT_SITE_URL = 'https://ventechgadgets.com';

const ENUM_LABELS: Record<string, string> = {
  air_cargo: 'Air cargo',
  sea_freight: 'Sea freight',
  processing: 'Processing',
  pending: 'Pending',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  completed: 'Completed',
  success: 'Successful',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
  paystack: 'Paystack',
  cash_on_delivery: 'Cash on delivery',
  bank_transfer: 'Bank transfer',
  momo: 'MoMo',
  cash: 'Cash',
  card: 'Card',
  submitted: 'Submitted',
  under_review: 'Under review',
  diagnosing: 'Diagnosing',
  repair_resolution: 'Repair resolution',
  ready: 'Ready',
  closed: 'Closed',
  active: 'Active',
  rejected: 'Rejected',
  approved: 'Approved',
  requested: 'Requested',
  reversed: 'Reversed',
  anytime: 'Anytime',
  month_end: 'Month end',
  principal: 'Principal',
  interest: 'Return',
  return: 'Return',
  scheduled: 'Scheduled',
  due: 'Due',
  settlement: 'Settlement',
  settle: 'Settle',
  renew: 'Renew',
  new: 'New',
  awaiting_payment: 'Awaiting payment',
  pre_order: 'Pre-order',
  regular: 'Regular',
};

export function enumLabel(value: string | null | undefined): string {
  if (!value) return '';
  const key = String(value).trim();
  if (!key) return '';
  const mapped = ENUM_LABELS[key] || ENUM_LABELS[key.toLowerCase()];
  if (mapped) return mapped;
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (ch) => ch.toUpperCase());
}

export function firstName(fullName: string | null | undefined): string {
  const raw = String(fullName || '').trim();
  if (!raw) return 'there';
  const token = raw.split(/\s+/)[0] || 'there';
  return token.replace(/,$/, '') || 'there';
}

export function greeting(fullName: string | null | undefined): string {
  return `Hi ${firstName(fullName)},`;
}

export function siteUrl(): string {
  const raw = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    (process.env.FRONTEND_URL || '').split(',')[0] ||
    DEFAULT_SITE_URL
  )
    .trim()
    .replace(/\/$/, '');
  if (!raw) return DEFAULT_SITE_URL;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export function absoluteUrl(path: string): string {
  if (!path) return siteUrl();
  if (/^https?:\/\//i.test(path)) return path;
  return `${siteUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

export function accountUrl(): string {
  return absoluteUrl('/account');
}

export function orderUrl(orderNumber?: string | null): string {
  if (orderNumber) return absoluteUrl(`/account/orders?open=${encodeURIComponent(orderNumber)}`);
  return absoluteUrl('/account/orders');
}

export function trackOrderUrl(): string {
  return absoluteUrl('/track-order');
}

export function contactUrl(): string {
  return absoluteUrl('/contact');
}

export function affiliateUrl(): string {
  return absoluteUrl('/account/affiliate');
}

export function investmentsUrl(id?: string | null): string {
  if (id) return absoluteUrl(`/account/investments/${encodeURIComponent(id)}`);
  return absoluteUrl('/account/investments');
}

export function adminOrderUrl(orderId?: string | null): string {
  if (orderId) return absoluteUrl(`/admin/orders?open=${encodeURIComponent(orderId)}`);
  return absoluteUrl('/admin/orders');
}

export function adminTicketUrl(ticketId?: string | null): string {
  if (ticketId) return absoluteUrl(`/admin/tickets/${encodeURIComponent(ticketId)}`);
  return absoluteUrl('/admin/tickets');
}

export function ticketUrl(ticketNo?: string | null): string {
  if (ticketNo) return absoluteUrl(`/account/tickets?open=${encodeURIComponent(ticketNo)}`);
  return absoluteUrl('/account/tickets');
}

export function deviceUrl(qrToken: string): string {
  return absoluteUrl(`/d/${encodeURIComponent(qrToken)}`);
}

export function formatMoneyGhs(amount: number | null | undefined): string {
  return formatCedis(amount);
}

export function formatMoneyPesewas(pesewas: number | null | undefined): string {
  return formatPesewas(pesewas);
}

function accraParts(input: Date): { day: number; month: number; year: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ACCRA,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(input);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    day: read('day'),
    month: read('month'),
    year: read('year'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

function asDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T12:00:00+00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateAccra(value: string | number | Date | null | undefined): string {
  const date = asDate(value);
  if (!date) return '';
  const parts = accraParts(date);
  const month = MONTHS[parts.month - 1] || '';
  return `${parts.day} ${month} ${parts.year}`;
}

export function formatTimeAccra(value: string | number | Date | null | undefined): string {
  const date = asDate(value);
  if (!date) return '';
  const parts = accraParts(date);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function formatDateTimeAccra(value: string | number | Date | null | undefined): string {
  const date = formatDateAccra(value);
  const time = formatTimeAccra(value);
  if (!date) return '';
  return time ? `${date} at ${time}` : date;
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function apostrophe(text: string): string {
  return text.replace(/'/g, '\u2019');
}
