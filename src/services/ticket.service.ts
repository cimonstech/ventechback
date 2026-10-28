import { adminNotificationEmail } from '../config/email';
import { emailService } from './email.service';
import { deletePrivateObject, getSignedViewUrl } from './privateStorage.service';
import { supabaseAdmin } from '../utils/supabaseClient';

export const TICKET_STATUSES = [
  'submitted',
  'under_review',
  'diagnosing',
  'repair_resolution',
  'ready',
  'completed',
  'closed',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const OPEN_STATUSES: TicketStatus[] = [
  'submitted',
  'under_review',
  'diagnosing',
  'repair_resolution',
  'ready',
];

const STAGES: TicketStatus[] = [
  'submitted',
  'under_review',
  'diagnosing',
  'repair_resolution',
  'ready',
  'completed',
];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  diagnosing: 'Diagnosing',
  repair_resolution: 'Repair resolution',
  ready: 'Ready',
  completed: 'Completed',
  closed: 'Closed',
};

export function statusMove(
  from: string,
  to: string,
  note: string | null,
  closedReason: string | null
): { ok: true } | { ok: false; message: string } {
  if (!TICKET_STATUSES.includes(to as TicketStatus)) {
    return { ok: false, message: 'That status is not available.' };
  }
  if (from === 'closed') return { ok: false, message: 'This request is already closed.' };
  if (to === from) return { ok: false, message: 'Choose a different status.' };
  if (to === 'closed') {
    if (!closedReason) return { ok: false, message: 'A reason is required to close this request.' };
    if (!OPEN_STATUSES.includes(from as TicketStatus) && from !== 'completed') {
      return { ok: false, message: 'That status change is not allowed.' };
    }
    return { ok: true };
  }

  const fromIndex = STAGES.indexOf(from as TicketStatus);
  const toIndex = STAGES.indexOf(to as TicketStatus);
  if (fromIndex < 0 || toIndex < 0) return { ok: false, message: 'That status change is not allowed.' };
  if (toIndex === fromIndex + 1) return { ok: true };
  if (toIndex === fromIndex - 1) {
    if (!note) return { ok: false, message: 'Add a note to move the request back a step.' };
    return { ok: true };
  }
  return { ok: false, message: 'That status change is not allowed.' };
}

export function displayName(user: {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null): string | null {
  if (!user) return null;
  const full = (user.full_name || '').trim();
  if (full) return full;
  const combined = [user.first_name, user.last_name].map((part) => (part || '').trim()).filter(Boolean).join(' ');
  if (combined) return combined;
  return (user.email || '').trim() || null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function siteOrigin(): string | null {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || '').trim().replace(/\/$/, '');
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export function adminTicketUrl(ticketId: string): string | null {
  const site = siteOrigin();
  if (!site) return null;
  return `${site}/admin/tickets/${ticketId}`;
}

async function sendTicketEmail(to: string, subject: string, html: string): Promise<void> {
  if (!to) {
    console.error('Ticket email skipped: no recipient');
    return;
  }
  try {
    const sent = await emailService.sendEmail({ to, subject, html });
    if (!sent) console.error('Ticket email was not sent:', subject);
  } catch (error) {
    console.error('Ticket email failed:', subject, error);
  }
}

function emailShell(heading: string, body: string): string {
  return `<div style="font-family:Arial,sans-serif;color:#1A1A1A;max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="font-size:22px;margin:0 0 16px;">${escapeHtml(heading)}</h1>
    ${body}
  </div>`;
}

export async function emailTicketReceived(to: string, ticketNo: string): Promise<void> {
  const heading = `We've received your service request ${ticketNo}`;
  await sendTicketEmail(
    to,
    heading,
    emailShell(heading, '<p>We have your request and will update you as it moves forward.</p>')
  );
}

export async function emailAdminNewTicket(input: {
  ticketId: string;
  ticketNo: string;
  issue: string;
  model: string;
}): Promise<void> {
  const heading = `New service request ${input.ticketNo}: ${input.issue} on ${input.model}`;
  const link = adminTicketUrl(input.ticketId);
  if (!link) console.error('Ticket admin email has no site URL for the admin ticket link');
  const button = link
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#FF7A19;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Open ticket</a></p>`
    : '';
  await sendTicketEmail(
    adminNotificationEmail,
    heading,
    emailShell(heading, `<p>${escapeHtml(input.issue)} on ${escapeHtml(input.model)}.</p>${button}`)
  );
}

export async function emailStatusChanged(to: string, ticketNo: string, status: TicketStatus, note: string | null): Promise<void> {
  const heading = `Your request ${ticketNo} is now: ${STATUS_LABEL[status]}`;
  const noteHtml = note ? `<p>${escapeHtml(note)}</p>` : '';
  await sendTicketEmail(to, heading, emailShell(heading, `${noteHtml}<p>${escapeHtml(heading)}</p>`));
}

export async function emailStaffReply(to: string, ticketNo: string, body: string): Promise<void> {
  const heading = `New reply on your request ${ticketNo}`;
  await sendTicketEmail(to, heading, emailShell(heading, `<p>${escapeHtml(body)}</p>`));
}

export const PAYMENT_METHODS = ['cash', 'momo', 'card', 'bank_transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'cash',
  momo: 'MoMo',
  card: 'card',
  bank_transfer: 'bank transfer',
};

export function formatTicketGhs(amount: number): string {
  return `GHS ${Number(amount).toFixed(2)}`;
}

export async function insertTicketEvent(input: {
  ticket_id: string;
  type: string;
  body: string | null;
  is_internal: boolean;
  actor_id: string | null;
  actor_role: string | null;
}): Promise<boolean> {
  const { error } = await supabaseAdmin.from('ticket_events').insert(input);
  if (error) {
    console.error('ticket event', error);
    return false;
  }
  return true;
}

export async function storeContact(): Promise<{ phone: string; email: string }> {
  const fallback = { phone: '+233 55 134 4310', email: 'ventechgadgets@gmail.com' };
  const { data, error } = await supabaseAdmin
    .from('settings')
    .select('key, value')
    .in('key', ['store_phone', 'store_email']);
  if (error) {
    console.error('ticket store contact', error);
    return fallback;
  }
  const phone = data?.find((row) => row.key === 'store_phone')?.value;
  const email = data?.find((row) => row.key === 'store_email')?.value;
  return {
    phone: (typeof phone === 'string' && phone.trim()) || fallback.phone,
    email: (typeof email === 'string' && email.trim()) || fallback.email,
  };
}

export function presentRepairReceipt(
  ticket: {
    ticket_no: string;
    laptop_model: string;
    repair_paid_amount: number | string | null;
    repair_paid_method: string | null;
    repair_paid_reference: string | null;
    repair_paid_at: string | null;
  },
  contact: { phone: string; email: string }
) {
  const method = ticket.repair_paid_method;
  return {
    ticket_no: ticket.ticket_no,
    laptop_model: ticket.laptop_model,
    amount: ticket.repair_paid_amount === null || ticket.repair_paid_amount === undefined
      ? null
      : Number(ticket.repair_paid_amount),
    method,
    method_label: method && method in PAYMENT_METHOD_LABEL
      ? PAYMENT_METHOD_LABEL[method as PaymentMethod]
      : method,
    reference: ticket.repair_paid_reference,
    paid_at: ticket.repair_paid_at,
    contact,
  };
}

export async function emailPaymentReceipt(input: {
  to: string;
  ticketNo: string;
  laptop: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  paidAt: string;
}): Promise<void> {
  const contact = await storeContact();
  const heading = `Payment receipt for ${input.ticketNo}`;
  const rows = [
    ['Ticket', input.ticketNo],
    ['Laptop', input.laptop],
    ['Amount', formatTicketGhs(input.amount)],
    ['Method', PAYMENT_METHOD_LABEL[input.method]],
    ['Reference', input.reference || '—'],
    ['Date', new Date(input.paidAt).toLocaleString('en-GB')],
    ['Contact', `${contact.email} · ${contact.phone}`],
  ];
  const body = `<p>We received your payment.</p>
    <table style="border-collapse:collapse;width:100%;margin-top:16px;">
      ${rows.map(([label, value]) => `<tr>
        <td style="padding:6px 0;color:#3A3A3A;width:120px;">${escapeHtml(label)}</td>
        <td style="padding:6px 0;font-weight:600;">${escapeHtml(value)}</td>
      </tr>`).join('')}
    </table>`;
  await sendTicketEmail(input.to, heading, emailShell(heading, body));
}

export async function emailCustomerMessage(input: {
  ticketId: string;
  ticketNo: string;
  body: string;
}): Promise<void> {
  const heading = `New message on ${input.ticketNo}`;
  const link = adminTicketUrl(input.ticketId);
  if (!link) console.error('Ticket admin email has no site URL for the admin ticket link');
  const button = link
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#FF7A19;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Open ticket</a></p>`
    : '';
  await sendTicketEmail(
    adminNotificationEmail,
    heading,
    emailShell(heading, `<p>${escapeHtml(input.body)}</p>${button}`)
  );
}

export async function signedMedia<T extends { r2_key: string }>(rows: T[]): Promise<Array<Omit<T, 'r2_key'> & { previewUrl: string }>> {
  const signed = [];
  for (const row of rows) {
    const previewUrl = await getSignedViewUrl(row.r2_key);
    const { r2_key: _key, ...rest } = row;
    signed.push({ ...rest, previewUrl });
  }
  return signed;
}

export async function userEmail(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('ticket customer email', error);
    return '';
  }
  return typeof data?.email === 'string' ? data.email : '';
}

export async function cleanupOrphanUploads(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let deleted = 0;
  for (let batch = 0; batch < 20; batch += 1) {
    const { data, error } = await supabaseAdmin
      .from('ticket_media')
      .select('id, r2_key')
      .is('ticket_id', null)
      .lt('created_at', cutoff)
      .limit(100);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      try {
        await deletePrivateObject(row.r2_key);
      } catch (objectError) {
        console.error('cleanup orphan upload object', objectError);
        continue;
      }
      const { error: deleteError } = await supabaseAdmin
        .from('ticket_media')
        .delete()
        .eq('id', row.id)
        .is('ticket_id', null);
      if (deleteError) {
        console.error('cleanup orphan upload row', deleteError);
        continue;
      }
      deleted += 1;
    }
  }
  return deleted;
}
