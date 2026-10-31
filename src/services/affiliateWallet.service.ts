import { Request } from 'express';
import { adminNotificationEmail } from '../config/email';
import { formatPesewas } from '../utils/money';
import { supabaseAdmin } from '../utils/supabaseClient';
import { logAudit } from './audit.service';
import { emailService } from './email.service';
import {
  AffiliateError,
  AffiliateRow,
  loadAffiliateByUser,
  siteOrigin,
} from './affiliate.service';
import { affiliateSettings } from './affiliateSettings.service';

type AuditReq = Request & { user?: { id?: string; role?: string } };

export interface PayoutInput {
  payout_method: 'momo' | 'bank';
  momo_network?: string;
  momo_number?: string;
  bank_name?: string;
  bank_account_name?: string;
  bank_account_number?: string;
}

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

function maskTail(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 3) return '*'.repeat(value.length);
  return `${'*'.repeat(value.length - 3)}${value.slice(-3)}`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function guestKey(order: { user_id?: string | null; customer_bio?: any; shipping_address?: any }): string | null {
  if (order.user_id) return `u:${order.user_id}`;
  const email = text(order.customer_bio?.email || order.shipping_address?.email).trim().toLowerCase();
  return email ? `e:${email}` : null;
}

async function ownAffiliate(userId: string): Promise<AffiliateRow> {
  const row = await loadAffiliateByUser(userId);
  if (!row) throw new AffiliateError(404, 'Affiliate application not found.');
  if (row.user_id !== userId) throw new AffiliateError(404, 'Affiliate application not found.');
  return row;
}

async function loadUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, first_name, last_name, full_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) logDb('load affiliate user', error);
  return data;
}

function displayName(user: { full_name?: string | null; first_name?: string | null; last_name?: string | null } | null): string {
  if (!user) return 'there';
  return user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'there';
}

export function presentPayout(row: AffiliateRow, masked: boolean) {
  const momo = text(row.momo_number);
  const bank = text(row.bank_account_number);
  return {
    payout_method: row.payout_method,
    momo_network: row.momo_network || null,
    momo_number: masked ? maskTail(momo) : momo || null,
    bank_name: row.bank_name || null,
    bank_account_name: row.bank_account_name || null,
    bank_account_number: masked ? maskTail(bank) : bank || null,
    payout_details_changed_at: typeof row.payout_details_changed_at === 'string' ? row.payout_details_changed_at : null,
  };
}

export function presentLinks(row: AffiliateRow) {
  if (row.status !== 'active' || !row.affiliate_no) return null;
  const origin = siteOrigin();
  if (!origin) return null;
  const code = row.referral_code || row.affiliate_no;
  return {
    general: `${origin}/?ref=${encodeURIComponent(code)}`,
    product: `${origin}/product/{slug}?ref=${encodeURIComponent(code)}`,
  };
}

export async function getMe(userId: string) {
  const row = await ownAffiliate(userId);
  const settings = await affiliateSettings.get();
  const feePaid = Boolean(row.fee_paid_at);
  const feeRefunded = Boolean(row.fee_refunded_at);
  return {
    id: row.id,
    status: row.status,
    affiliate_no: row.affiliate_no,
    referral_code: row.status === 'active' ? row.referral_code : null,
    terms_version: row.terms_version,
    terms_accepted_at: row.terms_accepted_at,
    withdrawal_mode: row.withdrawal_mode || 'anytime',
    payout: presentPayout(row, true),
    links: presentLinks(row),
    fee_paid_at: row.fee_paid_at,
    fee_refunded_at: typeof row.fee_refunded_at === 'string' ? row.fee_refunded_at : null,
    fee_amount_pesewas: row.fee_amount_pesewas,
    rejected_reason: row.status === 'rejected' && typeof row.rejected_reason === 'string' ? row.rejected_reason : null,
    suspended_reason: row.status === 'suspended' && typeof row.suspended_reason === 'string' ? row.suspended_reason : null,
    refund_due:
      row.status === 'rejected' && feePaid && !feeRefunded && settings.refundFeeOnRejection,
    created_at: row.created_at,
  };
}

export async function ledgerBalance(affiliateId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('affiliate_ledger')
    .select('amount_pesewas')
    .eq('affiliate_id', affiliateId);
  if (error) {
    logDb('ledger balance', error);
    throw new AffiliateError(500, 'Could not load your wallet.');
  }
  return (data || []).reduce((sum, row) => sum + (Number(row.amount_pesewas) || 0), 0);
}

async function commissionTotals(affiliateId: string) {
  const { data, error } = await supabaseAdmin
    .from('affiliate_commissions')
    .select('status, amount_pesewas')
    .eq('affiliate_id', affiliateId);
  if (error) {
    logDb('commission totals', error);
    throw new AffiliateError(500, 'Could not load your wallet.');
  }
  let pending = 0;
  let approved = 0;
  let approvedCount = 0;
  for (const row of data || []) {
    const amount = Number(row.amount_pesewas) || 0;
    if (row.status === 'pending') pending += amount;
    if (row.status === 'approved') {
      approved += amount;
      approvedCount += 1;
    }
  }
  return { pending, approved, approvedCount, total: pending + approved };
}

async function withdrawnTotal(affiliateId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('affiliate_withdrawals')
    .select('amount_pesewas')
    .eq('affiliate_id', affiliateId)
    .eq('status', 'paid');
  if (error) {
    logDb('withdrawn total', error);
    throw new AffiliateError(500, 'Could not load your wallet.');
  }
  return (data || []).reduce((sum, row) => sum + (Number(row.amount_pesewas) || 0), 0);
}

async function clickCount(affiliateId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('affiliate_clicks')
    .select('id', { count: 'exact', head: true })
    .eq('affiliate_id', affiliateId);
  if (error) {
    logDb('click count', error);
    throw new AffiliateError(500, 'Could not load your wallet.');
  }
  return count || 0;
}

export async function referredCustomerCount(affiliateId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('user_id, customer_bio, shipping_address')
    .eq('affiliate_id', affiliateId);
  if (error) {
    logDb('referred customers', error);
    throw new AffiliateError(500, 'Could not load referred customers.');
  }
  const keys = new Set<string>();
  for (const order of data || []) {
    const key = guestKey(order);
    if (key) keys.add(key);
  }
  return keys.size;
}

export async function getSummary(userId: string) {
  const row = await ownAffiliate(userId);
  const [clicks, referred, commissions, available, withdrawn] = await Promise.all([
    clickCount(row.id),
    referredCustomerCount(row.id),
    commissionTotals(row.id),
    ledgerBalance(row.id),
    withdrawnTotal(row.id),
  ]);
  return {
    link_clicks: clicks,
    referred_customers: referred,
    successful_sales: commissions.approvedCount,
    total_commission_pesewas: commissions.total,
    pending_pesewas: commissions.pending,
    available_pesewas: available,
    withdrawn_pesewas: withdrawn,
  };
}

export async function getSales(userId: string, page: number, limit: number) {
  const row = await ownAffiliate(userId);
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const { data, error, count } = await supabaseAdmin
    .from('orders')
    .select(
      `
      order_number, created_at, affiliate_skip_reason,
      order_items:order_items(product_name),
      commissions:affiliate_commissions!affiliate_commissions_order_id_fkey(status, amount_pesewas)
    `,
      { count: 'exact' }
    )
    .eq('affiliate_id', row.id)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) {
    logDb('affiliate sales', error);
    throw new AffiliateError(500, 'Could not load your sales.');
  }
  const rows = (data || []).map((item: any) => {
    const commission = Array.isArray(item.commissions) ? item.commissions[0] : item.commissions;
    const items = item.order_items || [];
    const names = items
      .map((line: { product_name?: string }) => line.product_name)
      .filter((name: unknown): name is string => typeof name === 'string' && !!name);
    return {
      order_number: item.order_number || null,
      product_names: names,
      date: item.created_at,
      commission_status: commission?.status || 'none',
      amount_pesewas: commission?.amount_pesewas || 0,
      skip_reason: item.affiliate_skip_reason || null,
    };
  });
  return { rows, total: count || 0 };
}

export async function getLedger(userId: string, page: number, limit: number) {
  const row = await ownAffiliate(userId);
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const { data, error, count } = await supabaseAdmin
    .from('affiliate_ledger')
    .select('id, type, amount_pesewas, commission_id, withdrawal_id, note, created_at', { count: 'exact' })
    .eq('affiliate_id', row.id)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) {
    logDb('affiliate ledger', error);
    throw new AffiliateError(500, 'Could not load your ledger.');
  }
  return { rows: data || [], total: count || 0 };
}

export async function getWithdrawals(userId: string, page: number, limit: number) {
  const row = await ownAffiliate(userId);
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const { data, error, count } = await supabaseAdmin
    .from('affiliate_withdrawals')
    .select(
      'id, amount_pesewas, mode, status, reason, payment_reference, processed_at, paid_at, created_at',
      { count: 'exact' }
    )
    .eq('affiliate_id', row.id)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) {
    logDb('affiliate withdrawals', error);
    throw new AffiliateError(500, 'Could not load your withdrawals.');
  }
  return { rows: data || [], total: count || 0 };
}

function sameText(left: unknown, right: unknown): boolean {
  return (typeof left === 'string' ? left : '') === (typeof right === 'string' ? right : '');
}

function payoutFieldsChanged(row: AffiliateRow, input: PayoutInput): boolean {
  if (input.payout_method !== row.payout_method) return true;
  if (input.payout_method === 'momo') {
    return !sameText(row.momo_network, input.momo_network) || !sameText(row.momo_number, input.momo_number);
  }
  return (
    !sameText(row.bank_name, input.bank_name)
    || !sameText(row.bank_account_name, input.bank_account_name)
    || !sameText(row.bank_account_number, input.bank_account_number)
  );
}

export async function updatePayout(req: AuditReq, userId: string, input: PayoutInput) {
  const row = await ownAffiliate(userId);
  const changed = payoutFieldsChanged(row, input);
  if (!changed) return presentPayout(row, true);
  const now = new Date().toISOString();
  const patch =
    input.payout_method === 'momo'
      ? {
          payout_method: 'momo' as const,
          momo_network: input.momo_network || null,
          momo_number: input.momo_number || null,
          bank_name: null,
          bank_account_name: null,
          bank_account_number: null,
          payout_details_changed_at: now,
        }
      : {
          payout_method: 'bank' as const,
          momo_network: null,
          momo_number: null,
          bank_name: input.bank_name || null,
          bank_account_name: input.bank_account_name || null,
          bank_account_number: input.bank_account_number || null,
          payout_details_changed_at: now,
        };

  const { data, error } = await supabaseAdmin
    .from('affiliates')
    .update(patch)
    .eq('id', row.id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error || !data) {
    logDb('update payout', error);
    throw new AffiliateError(500, 'Could not update payout details.');
  }

  await logAudit({
    req,
    entity: 'affiliate',
    entityId: row.id,
    action: 'payout_updated',
    before: row,
    after: data,
  });

  const user = await loadUser(userId);
  if (user?.email) {
    try {
      await emailService.sendEmail(
        {
          to: user.email,
          subject: 'Your payout details were changed',
          html: `
            <p>Hi ${escapeHtml(displayName(user))},</p>
            <p>Your affiliate payout details were changed. Withdrawals are held for a short period after this change.</p>
            <p>If you did not make this change, contact support.</p>
            <p>VENTECH Gadgets</p>
          `,
        },
        false
      );
    } catch (emailError) {
      logDb('email payout changed', emailError);
    }
  }

  return presentPayout(data as AffiliateRow, true);
}

export async function updateWithdrawalMode(req: AuditReq, userId: string, mode: 'anytime' | 'month_end') {
  const row = await ownAffiliate(userId);
  const { data, error } = await supabaseAdmin
    .from('affiliates')
    .update({ withdrawal_mode: mode })
    .eq('id', row.id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error || !data) {
    logDb('update withdrawal mode', error);
    throw new AffiliateError(500, 'Could not update withdrawal mode.');
  }
  await logAudit({
    req,
    entity: 'affiliate',
    entityId: row.id,
    action: 'withdrawal_mode_updated',
    before: row,
    after: data,
  });
  return { withdrawal_mode: data.withdrawal_mode };
}

function withdrawalRpcMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message || '');
  }
  return '';
}

export async function requestWithdrawal(req: AuditReq, userId: string, amountPesewas: number) {
  const row = await ownAffiliate(userId);
  if (row.status !== 'active') {
    throw new AffiliateError(409, 'You cannot withdraw right now.', 'cannot_withdraw');
  }
  const settings = await affiliateSettings.get();
  const { data, error } = await supabaseAdmin.rpc('request_affiliate_withdrawal', {
    p_affiliate_id: row.id,
    p_amount_pesewas: amountPesewas,
    p_min_pesewas: settings.withdrawalMinPesewas,
    p_hold_hours: settings.payoutChangeHoldHours,
    p_created_by: userId,
  });

  if (error) {
    const message = withdrawalRpcMessage(error);
    logDb('request_affiliate_withdrawal', error);
    if (message.includes('Affiliate not found')) throw new AffiliateError(404, 'Affiliate application not found.');
    if (message.includes('Affiliate is not active')) throw new AffiliateError(409, 'You cannot withdraw right now.', 'cannot_withdraw');
    if (message.includes('below the minimum')) throw new AffiliateError(400, 'Amount is below the minimum withdrawal.');
    if (message.includes('Payout details are not set')) throw new AffiliateError(400, 'Payout details are not set.');
    if (message.includes('changed recently')) {
      throw new AffiliateError(400, 'Payout details were changed recently. Try again after the hold period.');
    }
    if (message.includes('Insufficient available balance')) {
      throw new AffiliateError(400, 'Insufficient available balance.');
    }
    if (message.includes('Enter a valid withdrawal amount')) {
      throw new AffiliateError(400, 'Enter a valid withdrawal amount.');
    }
    if ((error as { code?: string }).code === '23505' || /affiliate_withdrawals_one_open/i.test(message)) {
      throw new AffiliateError(409, 'You already have an open withdrawal.');
    }
    throw new AffiliateError(500, 'Could not request this withdrawal. Please try again.');
  }

  const ids = (data || {}) as { withdrawal_id?: string; ledger_id?: string };
  const { data: withdrawal, error: loadError } = await supabaseAdmin
    .from('affiliate_withdrawals')
    .select('id, amount_pesewas, mode, status, created_at')
    .eq('id', ids.withdrawal_id)
    .eq('affiliate_id', row.id)
    .maybeSingle();
  if (loadError || !withdrawal) {
    logDb('load new withdrawal', loadError);
    throw new AffiliateError(500, 'Could not request this withdrawal. Please try again.');
  }

  await logAudit({
    req,
    entity: 'affiliate',
    entityId: row.id,
    action: 'withdrawal_requested',
    after: { withdrawal, ledger_id: ids.ledger_id },
  });

  const user = await loadUser(userId);
  const amountLabel = formatPesewas(amountPesewas);
  try {
    if (user?.email) {
      await emailService.sendEmail(
        {
          to: user.email,
          subject: 'Withdrawal requested',
          html: `
            <p>Hi ${escapeHtml(displayName(user))},</p>
            <p>We received your withdrawal request for ${escapeHtml(amountLabel)}.</p>
            <p>VENTECH Gadgets</p>
          `,
        },
        false
      );
    }
  } catch (emailError) {
    logDb('email affiliate withdrawal', emailError);
  }
  try {
    await emailService.sendEmail(
      {
        to: adminNotificationEmail,
        subject: 'Affiliate withdrawal requested',
        html: `
          <p>An affiliate requested a withdrawal of ${escapeHtml(amountLabel)}.</p>
          <p><strong>Affiliate:</strong> ${escapeHtml(row.affiliate_no || row.id)}</p>
        `,
      },
      true
    );
  } catch (emailError) {
    logDb('email admin withdrawal', emailError);
  }

  return withdrawal;
}

export async function searchProducts(userId: string, q: string) {
  await ownAffiliate(userId);
  const term = q.replace(/[%_\\,()]/g, '').trim().slice(0, 80);
  if (!term) throw new AffiliateError(400, 'Enter a search term.');
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('name, slug')
    .or(`name.ilike.%${term}%,slug.ilike.%${term}%`)
    .order('name', { ascending: true })
    .limit(20);
  if (error) {
    logDb('affiliate product search', error);
    throw new AffiliateError(500, 'Could not search products.');
  }
  return (data || []).map((product) => ({ name: product.name, slug: product.slug }));
}
