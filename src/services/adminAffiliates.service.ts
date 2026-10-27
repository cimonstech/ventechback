import { Request } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { logAudit } from './audit.service';
import { emailService } from './email.service';
import {
  AffiliateError,
  AffiliateRow,
  activateAffiliate,
  grantAffiliateRole,
  loadAffiliateById,
} from './affiliate.service';
import { presentLinks, presentPayout } from './affiliateWallet.service';
import { affiliateSettings } from './affiliateSettings.service';
import { approveCommission, reverseCommissionById } from './affiliateCommission.service';

type AuditReq = Request & { user?: { id?: string; role?: string } };

const OPEN_WITHDRAWAL = ['requested', 'processing', 'approved'] as const;

function logDb(scope: string, error: unknown) {
  console.error(scope, error);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function searchTerm(raw: string): string {
  return raw.replace(/[%_\\",()]/g, '').trim().slice(0, 80);
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function loadUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, phone, first_name, last_name, full_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) logDb('load affiliate user', error);
  return data;
}

function userName(user: { full_name?: string | null; first_name?: string | null; last_name?: string | null } | null): string {
  if (!user) return 'there';
  return user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'there';
}

function presentListAffiliate(row: any) {
  const user = Array.isArray(row.user) ? row.user[0] : row.user;
  return {
    id: row.id,
    status: row.status,
    affiliate_no: row.affiliate_no,
    referral_code: row.status === 'active' ? row.referral_code : null,
    fee_paid_at: row.fee_paid_at,
    created_at: row.created_at,
    user: user
      ? {
          id: user.id,
          name: userName(user),
          email: user.email || null,
        }
      : null,
  };
}

export async function listAffiliates(input: { page: number; limit: number; status?: string; search?: string }) {
  const from = (input.page - 1) * input.limit;
  const to = from + input.limit - 1;
  let query = supabaseAdmin
    .from('affiliates')
    .select(
      'id, status, affiliate_no, referral_code, fee_paid_at, created_at, user:users!affiliates_user_id_fkey(id, first_name, last_name, full_name, email)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false });

  if (input.status) query = query.eq('status', input.status);

  const term = searchTerm(input.search || '');
  if (term) {
    const { data: users, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .or(`email.ilike.%${term}%,full_name.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
    if (userError) {
      logDb('search affiliate users', userError);
      throw new AffiliateError(500, 'Could not load affiliates.');
    }
    const userIds = (users || []).map((user) => user.id);
    const parts = [`affiliate_no.ilike.%${term}%`, `referral_code.ilike.%${term}%`];
    if (userIds.length) parts.push(`user_id.in.(${userIds.join(',')})`);
    query = query.or(parts.join(','));
  }

  const { data, error, count } = await query.range(from, to);
  if (error) {
    logDb('list affiliates', error);
    throw new AffiliateError(500, 'Could not load affiliates.');
  }
  return { rows: (data || []).map(presentListAffiliate), total: count || 0 };
}

export async function getAffiliate(id: string) {
  const row = await loadAffiliateById(id);
  if (!row) throw new AffiliateError(404, 'Affiliate not found.');
  const settings = await affiliateSettings.get();
  const user = await loadUser(row.user_id);

  const [clickResult, commissions, withdrawals, ledger, orders] = await Promise.all([
    supabaseAdmin
      .from('affiliate_clicks')
      .select('created_at', { count: 'exact' })
      .eq('affiliate_id', row.id)
      .order('created_at', { ascending: false })
      .limit(1),
    supabaseAdmin
      .from('affiliate_commissions')
      .select('id, order_id, checkout_reference, amount_pesewas, status, eligible_from, reason, created_at')
      .eq('affiliate_id', row.id)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('affiliate_withdrawals')
      .select('id, amount_pesewas, mode, status, reason, payment_reference, processed_at, paid_at, created_at')
      .eq('affiliate_id', row.id)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('affiliate_ledger')
      .select('id, type, amount_pesewas, commission_id, withdrawal_id, note, created_at')
      .eq('affiliate_id', row.id)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('orders')
      .select('id, order_number, total, status, payment_status, delivered_at, created_at')
      .eq('affiliate_id', row.id)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  if (clickResult.error) logDb('affiliate clicks summary', clickResult.error);
  if (commissions.error) logDb('affiliate commissions', commissions.error);
  if (withdrawals.error) logDb('affiliate withdrawals', withdrawals.error);
  if (ledger.error) logDb('affiliate ledger', ledger.error);
  if (orders.error) logDb('affiliate orders', orders.error);

  const refundDue =
    settings.refundFeeOnRejection &&
    row.status === 'rejected' &&
    !!row.fee_paid_at &&
    !row.fee_refunded_at;

  return {
    profile: {
      id: row.id,
      status: row.status,
      affiliate_no: row.affiliate_no,
      referral_code: row.status === 'active' ? row.referral_code : null,
      promo_channels: row.promo_channels,
      social_handles: row.social_handles,
      withdrawal_mode: row.withdrawal_mode,
      terms_version: row.terms_version,
      terms_accepted_at: row.terms_accepted_at,
      approved_at: row.approved_at,
      rejected_reason: row.rejected_reason,
      suspended_reason: row.suspended_reason,
      created_at: row.created_at,
      payout: presentPayout(row, false),
      links: presentLinks(row),
      user: user
        ? {
            id: user.id,
            name: userName(user),
            email: user.email || null,
            phone: user.phone || null,
          }
        : null,
    },
    clicks: {
      total: clickResult.count || 0,
      last_at: clickResult.data?.[0]?.created_at || null,
    },
    orders: orders.data || [],
    commissions: commissions.data || [],
    ledger: ledger.data || [],
    withdrawals: withdrawals.data || [],
    fee: {
      amount_pesewas: row.fee_amount_pesewas,
      reference: row.fee_reference,
      paid_at: row.fee_paid_at,
      refund_due: refundDue,
      refunded_at: row.fee_refunded_at,
      refund_reference: row.fee_refund_reference,
    },
  };
}

export async function approveAffiliate(req: AuditReq, id: string) {
  const row = await loadAffiliateById(id);
  if (!row) throw new AffiliateError(404, 'Affiliate not found.');
  if (row.status === 'active') throw new AffiliateError(409, 'This affiliate is already active.');
  if (row.status === 'awaiting_payment') {
    throw new AffiliateError(400, 'The application fee has not been paid.');
  }
  if (row.status !== 'pending' && row.status !== 'rejected') {
    throw new AffiliateError(400, 'This application cannot be approved.');
  }
  const activated = await activateAffiliate(row, req);
  const user = await loadUser(activated.user_id);
  const links = presentLinks(activated);
  try {
    if (user?.email) {
      await emailService.sendEmail(
        {
          to: user.email,
          subject: 'Your affiliate account is active',
          html: `
            <p>Hi ${escapeHtml(userName(user))},</p>
            <p>Your VENTECH affiliate account is active. Your code is ${escapeHtml(activated.affiliate_no || '')}.</p>
            ${links?.general ? `<p>Share this link: ${escapeHtml(links.general)}</p>` : ''}
            <p>VENTECH Gadgets</p>
          `,
        },
        false
      );
    }
  } catch (emailError) {
    logDb('email affiliate approved', emailError);
  }
  return { id: activated.id, status: activated.status, affiliate_no: activated.affiliate_no, links };
}

export async function rejectAffiliate(req: AuditReq, id: string, reason: string) {
  const row = await loadAffiliateById(id);
  if (!row) throw new AffiliateError(404, 'Affiliate not found.');
  if (row.status === 'rejected') throw new AffiliateError(409, 'This application is already rejected.');
  if (row.status === 'active') throw new AffiliateError(400, 'Suspend an active affiliate instead.');
  const { data, error } = await supabaseAdmin
    .from('affiliates')
    .update({
      status: 'rejected',
      rejected_reason: reason,
    })
    .eq('id', row.id)
    .select('*')
    .single();
  if (error || !data) {
    logDb('reject affiliate', error);
    throw new AffiliateError(500, 'Could not reject this application.');
  }
  await logAudit({
    req,
    entity: 'affiliate',
    entityId: row.id,
    action: 'rejected',
    before: row,
    after: data,
  });
  const settings = await affiliateSettings.get();
  const refundDue = settings.refundFeeOnRejection && !!data.fee_paid_at && !data.fee_refunded_at;
  const user = await loadUser(row.user_id);
  try {
    if (user?.email) {
      await emailService.sendEmail(
        {
          to: user.email,
          subject: 'Your affiliate application was not approved',
          html: `
            <p>Hi ${escapeHtml(userName(user))},</p>
            <p>Your affiliate application was not approved.</p>
            <p>${escapeHtml(reason)}</p>
            <p>VENTECH Gadgets</p>
          `,
        },
        false
      );
    }
  } catch (emailError) {
    logDb('email affiliate rejected', emailError);
  }
  return { id: data.id, status: data.status, refund_due: refundDue };
}

export async function recordFeeRefund(req: AuditReq, id: string, reference: string) {
  const row = await loadAffiliateById(id);
  if (!row) throw new AffiliateError(404, 'Affiliate not found.');
  if (row.fee_refunded_at) throw new AffiliateError(409, 'This fee refund is already recorded.');
  if (!row.fee_paid_at) throw new AffiliateError(400, 'This application has no paid fee to refund.');
  const { data, error } = await supabaseAdmin
    .from('affiliates')
    .update({
      fee_refunded_at: new Date().toISOString(),
      fee_refund_reference: reference,
    })
    .eq('id', row.id)
    .is('fee_refunded_at', null)
    .select('*')
    .maybeSingle();
  if (error) {
    logDb('record fee refund', error);
    throw new AffiliateError(500, 'Could not record this refund.');
  }
  if (!data) throw new AffiliateError(409, 'This fee refund is already recorded.');
  await logAudit({
    req,
    entity: 'affiliate',
    entityId: row.id,
    action: 'fee_refunded',
    before: row,
    after: data,
  });
  return {
    id: data.id,
    fee_refunded_at: data.fee_refunded_at,
    fee_refund_reference: data.fee_refund_reference,
  };
}

export async function suspendAffiliate(req: AuditReq, id: string, reason: string) {
  const row = await loadAffiliateById(id);
  if (!row) throw new AffiliateError(404, 'Affiliate not found.');
  if (row.status !== 'active') throw new AffiliateError(400, 'Only an active affiliate can be suspended.');
  const { data, error } = await supabaseAdmin
    .from('affiliates')
    .update({
      status: 'suspended',
      suspended_reason: reason,
    })
    .eq('id', row.id)
    .eq('status', 'active')
    .select('*')
    .maybeSingle();
  if (error) {
    logDb('suspend affiliate', error);
    throw new AffiliateError(500, 'Could not suspend this affiliate.');
  }
  if (!data) throw new AffiliateError(409, 'This affiliate is not active.');
  await grantAffiliateRole(row.user_id, 'suspended');
  await logAudit({
    req,
    entity: 'affiliate',
    entityId: row.id,
    action: 'suspended',
    before: row,
    after: data,
  });
  return { id: data.id, status: data.status };
}

export async function reactivateAffiliate(req: AuditReq, id: string) {
  const row = await loadAffiliateById(id);
  if (!row) throw new AffiliateError(404, 'Affiliate not found.');
  if (row.status !== 'suspended') throw new AffiliateError(400, 'Only a suspended affiliate can be reactivated.');
  if (!row.affiliate_no) throw new AffiliateError(400, 'This affiliate has no number yet.');
  const { data, error } = await supabaseAdmin
    .from('affiliates')
    .update({
      status: 'active',
      referral_code: row.affiliate_no,
      suspended_reason: null,
    })
    .eq('id', row.id)
    .eq('status', 'suspended')
    .select('*')
    .maybeSingle();
  if (error) {
    logDb('reactivate affiliate', error);
    throw new AffiliateError(500, 'Could not reactivate this affiliate.');
  }
  if (!data) throw new AffiliateError(409, 'This affiliate is not suspended.');
  await grantAffiliateRole(row.user_id, 'active');
  await logAudit({
    req,
    entity: 'affiliate',
    entityId: row.id,
    action: 'reactivated',
    before: row,
    after: data,
  });
  return { id: data.id, status: data.status, affiliate_no: data.affiliate_no };
}

export async function listCommissions(input: {
  page: number;
  limit: number;
  status?: string;
  ready?: boolean;
}) {
  const from = (input.page - 1) * input.limit;
  const to = from + input.limit - 1;
  let query = supabaseAdmin
    .from('affiliate_commissions')
    .select(
      `
      id, affiliate_id, order_id, checkout_reference, amount_pesewas, status, eligible_from, reason, created_at,
      affiliate:affiliates!affiliate_commissions_affiliate_id_fkey(affiliate_no, status),
      order:orders!affiliate_commissions_order_id_fkey(order_number, status, payment_status)
    `,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false });
  if (input.status) query = query.eq('status', input.status);
  if (input.ready) {
    query = query.eq('status', 'pending').lte('eligible_from', new Date().toISOString());
  }
  const { data, error, count } = await query.range(from, to);
  if (error) {
    logDb('list commissions', error);
    throw new AffiliateError(500, 'Could not load commissions.');
  }
  return { rows: data || [], total: count || 0 };
}

export async function approveCommissionAdmin(req: AuditReq, id: string) {
  return approveCommission(req, id);
}

export async function reverseCommissionAdmin(req: AuditReq, id: string, reason: string) {
  return reverseCommissionById(req, id, reason);
}

export async function listWithdrawalsAdmin(input: { page: number; limit: number; status?: string }) {
  const from = (input.page - 1) * input.limit;
  const to = from + input.limit - 1;
  let query = supabaseAdmin
    .from('affiliate_withdrawals')
    .select(
      `
      id, affiliate_id, amount_pesewas, mode, status, reason, payment_reference, processed_at, paid_at, created_at, payout_snapshot,
      affiliate:affiliates!affiliate_withdrawals_affiliate_id_fkey(affiliate_no, status)
    `,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false });
  if (input.status) query = query.eq('status', input.status);
  const { data, error, count } = await query.range(from, to);
  if (error) {
    logDb('list withdrawals', error);
    throw new AffiliateError(500, 'Could not load withdrawals.');
  }
  return { rows: data || [], total: count || 0 };
}

export async function updateWithdrawalStatus(
  req: AuditReq,
  id: string,
  input: { to: 'processing' | 'approved' | 'paid' | 'rejected'; reason?: string; payment_reference?: string }
) {
  const { data: withdrawal, error } = await supabaseAdmin
    .from('affiliate_withdrawals')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logDb('load withdrawal', error);
    throw new AffiliateError(500, 'Could not update this withdrawal.');
  }
  if (!withdrawal) throw new AffiliateError(404, 'Withdrawal not found.');
  if (withdrawal.status === 'paid' || withdrawal.status === 'rejected') {
    throw new AffiliateError(409, 'This withdrawal cannot be changed.');
  }
  if (input.to === withdrawal.status) {
    return withdrawal;
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: input.to,
    processed_by: req.user?.id || null,
    processed_at: now,
  };
  if (input.reason) patch.reason = input.reason;
  if (input.to === 'paid') {
    patch.paid_at = now;
    if (input.payment_reference) patch.payment_reference = input.payment_reference;
  }
  if (input.to === 'rejected' && input.reason) patch.reason = input.reason;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('affiliate_withdrawals')
    .update(patch)
    .eq('id', withdrawal.id)
    .in('status', [...OPEN_WITHDRAWAL])
    .select('*')
    .maybeSingle();
  if (updateError) {
    logDb('update withdrawal', updateError);
    throw new AffiliateError(500, 'Could not update this withdrawal.');
  }
  if (!updated) throw new AffiliateError(409, 'This withdrawal cannot be changed.');

  if (input.to === 'rejected') {
    const { error: ledgerError } = await supabaseAdmin.from('affiliate_ledger').insert({
      affiliate_id: updated.affiliate_id,
      type: 'withdrawal_released',
      amount_pesewas: updated.amount_pesewas,
      withdrawal_id: updated.id,
      note: input.reason || 'Withdrawal rejected',
      created_by: req.user?.id || null,
    });
    if (ledgerError && (ledgerError as { code?: string }).code !== '23505') {
      logDb('withdrawal released ledger', ledgerError);
      throw new AffiliateError(500, 'Could not update this withdrawal.');
    }
  }

  await logAudit({
    req,
    entity: 'affiliate',
    entityId: updated.affiliate_id,
    action: `withdrawal_${input.to}`,
    before: withdrawal,
    after: updated,
  });

  const affiliate = await loadAffiliateById(updated.affiliate_id);
  const user = affiliate ? await loadUser(affiliate.user_id) : null;
  try {
    if (user?.email) {
      await emailService.sendEmail(
        {
          to: user.email,
          subject: `Withdrawal ${input.to}`,
          html: `
            <p>Hi ${escapeHtml(userName(user))},</p>
            <p>Your withdrawal of GH₵ ${(updated.amount_pesewas / 100).toFixed(2)} is now ${escapeHtml(input.to)}.</p>
            ${input.reason ? `<p>${escapeHtml(input.reason)}</p>` : ''}
            <p>VENTECH Gadgets</p>
          `,
        },
        false
      );
    }
  } catch (emailError) {
    logDb('email withdrawal status', emailError);
  }
  return updated;
}

export async function getMetrics() {
  const [
    total,
    active,
    fees,
    clicks,
    commissions,
    openWithdrawals,
    paidWithdrawals,
    attributedOrders,
  ] = await Promise.all([
    supabaseAdmin.from('affiliates').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('affiliates').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabaseAdmin.from('affiliates').select('fee_amount_pesewas').not('fee_paid_at', 'is', null),
    supabaseAdmin.from('affiliate_clicks').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('affiliate_commissions').select('status, amount_pesewas, affiliate_id'),
    supabaseAdmin
      .from('affiliate_withdrawals')
      .select('id', { count: 'exact', head: true })
      .in('status', [...OPEN_WITHDRAWAL]),
    supabaseAdmin.from('affiliate_withdrawals').select('amount_pesewas').eq('status', 'paid'),
    supabaseAdmin.from('orders').select('affiliate_id, user_id, customer_bio, shipping_address').not('affiliate_id', 'is', null),
  ]);

  if (total.error) logDb('metrics total', total.error);
  if (active.error) logDb('metrics active', active.error);
  if (fees.error) logDb('metrics fees', fees.error);
  if (clicks.error) logDb('metrics clicks', clicks.error);
  if (commissions.error) logDb('metrics commissions', commissions.error);
  if (openWithdrawals.error) logDb('metrics open withdrawals', openWithdrawals.error);
  if (paidWithdrawals.error) logDb('metrics paid withdrawals', paidWithdrawals.error);
  if (attributedOrders.error) logDb('metrics orders', attributedOrders.error);

  const feeTotal = (fees.data || []).reduce((sum, row) => sum + (Number(row.fee_amount_pesewas) || 0), 0);
  let pending = 0;
  let approved = 0;
  let approvedCount = 0;
  for (const row of commissions.data || []) {
    const amount = Number(row.amount_pesewas) || 0;
    if (row.status === 'pending') pending += amount;
    if (row.status === 'approved') {
      approved += amount;
      approvedCount += 1;
    }
  }
  const paidOut = (paidWithdrawals.data || []).reduce((sum, row) => sum + (Number(row.amount_pesewas) || 0), 0);

  const customers = new Set<string>();
  for (const order of attributedOrders.data || []) {
    if (order.user_id) customers.add(`u:${order.user_id}`);
    else {
      const email = String(
        (order.customer_bio as any)?.email || (order.shipping_address as any)?.email || ''
      )
        .trim()
        .toLowerCase();
      if (email) customers.add(`e:${email}`);
    }
  }

  return {
    total_affiliates: total.count || 0,
    active_affiliates: active.count || 0,
    total_fees_paid_pesewas: feeTotal,
    link_clicks: clicks.count || 0,
    referred_customers: customers.size,
    affiliate_sales: approvedCount,
    total_commissions_pesewas: pending + approved,
    pending_pesewas: pending,
    paid_pesewas: paidOut,
    open_withdrawal_requests: openWithdrawals.count || 0,
  };
}

export async function exportCsv(kind: 'affiliates' | 'commissions' | 'withdrawals', filters: { status?: string; search?: string; ready?: boolean }) {
  if (kind === 'affiliates') {
    const listed = await listAffiliates({ page: 1, limit: 10000, status: filters.status, search: filters.search });
    return toCsv(
      ['id', 'status', 'affiliate_no', 'email', 'name', 'fee_paid_at', 'created_at'],
      listed.rows.map((row) => [
        row.id,
        row.status,
        row.affiliate_no,
        row.user?.email || '',
        row.user?.name || '',
        row.fee_paid_at,
        row.created_at,
      ])
    );
  }
  if (kind === 'commissions') {
    const listed = await listCommissions({ page: 1, limit: 10000, status: filters.status, ready: filters.ready });
    return toCsv(
      ['id', 'affiliate_no', 'order_number', 'amount_pesewas', 'status', 'eligible_from', 'created_at'],
      listed.rows.map((row: any) => {
        const affiliate = Array.isArray(row.affiliate) ? row.affiliate[0] : row.affiliate;
        const order = Array.isArray(row.order) ? row.order[0] : row.order;
        return [
          row.id,
          affiliate?.affiliate_no || '',
          order?.order_number || '',
          row.amount_pesewas,
          row.status,
          row.eligible_from,
          row.created_at,
        ];
      })
    );
  }
  const listed = await listWithdrawalsAdmin({ page: 1, limit: 10000, status: filters.status });
  return toCsv(
    ['id', 'affiliate_no', 'amount_pesewas', 'mode', 'status', 'payment_reference', 'created_at', 'paid_at'],
    listed.rows.map((row: any) => {
      const affiliate = Array.isArray(row.affiliate) ? row.affiliate[0] : row.affiliate;
      return [
        row.id,
        affiliate?.affiliate_no || '',
        row.amount_pesewas,
        row.mode,
        row.status,
        row.payment_reference,
        row.created_at,
        row.paid_at,
      ];
    })
  );
}

export async function getSettingsPublic() {
  const settings = await affiliateSettings.get();
  return affiliateSettings.toPublic(settings);
}

export async function saveSettings(req: AuditReq, values: Record<string, string>) {
  const before = await affiliateSettings.get();
  const after = await affiliateSettings.save(values, req.user?.id || '');
  await logAudit({
    req,
    entity: 'affiliate',
    entityId: 'settings',
    action: 'settings_updated',
    before: affiliateSettings.toPublic(before),
    after: affiliateSettings.toPublic(after),
  });
  return affiliateSettings.toPublic(after);
}
