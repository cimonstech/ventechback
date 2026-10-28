import { Request } from 'express';
import { adminNotificationEmail } from '../config/email';
import { supabaseAdmin } from '../utils/supabaseClient';
import { logAudit } from './audit.service';
import { emailService } from './email.service';
import { getSignedViewUrl } from './privateStorage.service';
import { VlbError } from './vlb.service';
import {
  PlanSnapshot,
  addMonths,
  daysBetween,
  snapshotFromPlan,
  termProgress,
  todayAccra,
} from './vlbCalc.service';

type AuditReq = Request & { user?: { id?: string; role?: string } };

export interface InvestorRow {
  id: string;
  user_id: string;
  investor_no: string | null;
  payout_method: 'momo' | 'bank' | null;
  momo_network: string | null;
  momo_number: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  payout_details_changed_at: string | null;
}

export interface InvestmentRow {
  id: string;
  investor_id: string;
  plan_id: string;
  application_id: string | null;
  plan_snapshot: PlanSnapshot & Record<string, unknown>;
  principal_pesewas: number;
  start_date: string;
  maturity_date: string;
  status: string;
  renewal_choice: 'settle' | 'renew';
  renewal_chosen_at: string | null;
  renewed_into_id: string | null;
  extra_rate_percent: number | string;
  stars_total: number;
  stars_used: number;
  [key: string]: unknown;
}

export interface PayoutRow {
  id: string;
  investment_id: string;
  type: 'return' | 'principal';
  term_no: number | null;
  period_no: number;
  due_date: string;
  gross_pesewas: number;
  scholar_pesewas: number;
  net_pesewas: number;
  status: string;
  paid_at: string | null;
  method: string | null;
  reference: string | null;
  notes: string | null;
}

export interface PayoutInput {
  payout_method: 'momo' | 'bank';
  momo_network?: string;
  momo_number?: string;
  bank_name?: string;
  bank_account_name?: string;
  bank_account_number?: string;
}

function logDb(scope: string, error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : String(error);
  console.error(`vlb investor ${scope}`, message);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function maskTail(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 3) return '*'.repeat(value.length);
  return `${'*'.repeat(value.length - 3)}${value.slice(-3)}`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function dateOnly(value: unknown): string {
  return String(value || '').slice(0, 10);
}

function snapshotOf(investment: InvestmentRow): PlanSnapshot {
  return snapshotFromPlan(investment.plan_snapshot as Parameters<typeof snapshotFromPlan>[0]);
}

function planNameOf(investment: InvestmentRow): string {
  const snap = investment.plan_snapshot as { name?: string };
  return snap?.name || 'Laptop Banking';
}

export function presentPayoutDetails(row: InvestorRow, masked: boolean) {
  const momo = text(row.momo_number);
  const bank = text(row.bank_account_number);
  return {
    payout_method: row.payout_method,
    momo_network: row.momo_network || null,
    momo_number: masked ? maskTail(momo) : momo || null,
    bank_name: row.bank_name || null,
    bank_account_name: row.bank_account_name || null,
    bank_account_number: masked ? maskTail(bank) : bank || null,
    payout_details_changed_at: row.payout_details_changed_at,
  };
}

export async function ownInvestor(userId: string): Promise<InvestorRow> {
  const { data, error } = await supabaseAdmin
    .from('investors')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    logDb('own investor', error);
    throw new VlbError(500, 'Could not load your investor account.');
  }
  if (!data || data.user_id !== userId) {
    throw new VlbError(404, 'Investor account not found.');
  }
  return data as InvestorRow;
}

export async function loadInvestorById(id: string): Promise<InvestorRow> {
  const { data, error } = await supabaseAdmin
    .from('investors')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logDb('load investor', error);
    throw new VlbError(500, 'Could not load this investor.');
  }
  if (!data) throw new VlbError(404, 'Investor not found.');
  return data as InvestorRow;
}

async function loadUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, first_name, last_name, full_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) logDb('load user', error);
  return data;
}

function displayName(user: { full_name?: string | null; first_name?: string | null; last_name?: string | null } | null): string {
  if (!user) return 'there';
  return user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'there';
}

export async function loadPayouts(investmentIds: string[]): Promise<PayoutRow[]> {
  if (investmentIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('vlb_payouts')
    .select('*')
    .in('investment_id', investmentIds)
    .order('period_no', { ascending: true });
  if (error) {
    logDb('load payouts', error);
    throw new VlbError(500, 'Could not load payouts.');
  }
  return (data || []) as PayoutRow[];
}

function summarizeInvestment(investment: InvestmentRow, payouts: PayoutRow[], today: string) {
  const snapshot = snapshotOf(investment);
  const progress = termProgress(snapshot, dateOnly(investment.start_date), today);
  const horizon = horizonProgress(investment, today);
  const returns = payouts.filter((row) => row.type === 'return');
  const principal = payouts.find((row) => row.type === 'principal');
  const paidReturns = returns.filter((row) => row.status === 'paid');
  const next = payouts
    .filter((row) => row.status === 'scheduled' || row.status === 'due' || row.status === 'processing')
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.period_no - b.period_no)[0];

  return {
    id: investment.id,
    plan_name: planNameOf(investment),
    plan_id: investment.plan_id,
    principal_pesewas: Number(investment.principal_pesewas),
    start_date: dateOnly(investment.start_date),
    maturity_date: dateOnly(investment.maturity_date),
    status: investment.status,
    current_term: progress.current_term,
    term_progress: {
      days_elapsed: progress.days_elapsed,
      days_total: progress.days_total,
    },
    next_payout: next
      ? {
          date: dateOnly(next.due_date),
          type: next.type,
          period_no: next.period_no,
          gross_pesewas: Number(next.gross_pesewas),
          scholar_pesewas: Number(next.scholar_pesewas),
          net_pesewas: Number(next.net_pesewas),
          status: next.status,
        }
      : null,
    totals_paid_pesewas: paidReturns.reduce((sum, row) => sum + Number(row.net_pesewas), 0)
      + (principal?.status === 'paid' ? Number(principal.net_pesewas) : 0),
    scholar_fund_deducted_pesewas: paidReturns.reduce((sum, row) => sum + Number(row.scholar_pesewas), 0),
    principal_settlement: principal
      ? {
          status: principal.status,
          due_date: dateOnly(principal.due_date),
          net_pesewas: Number(principal.net_pesewas),
          paid_at: principal.paid_at,
        }
      : null,
    renewal_choice: investment.renewal_choice,
    renewal_chosen_at: investment.renewal_chosen_at,
    renewal_open: progress.renewal_open && (investment.status === 'active' || investment.status === 'settlement'),
    stars_total: Number(investment.stars_total),
    stars_used: Number(investment.stars_used),
    horizon_months: horizon.months,
    horizon_progress: {
      days_elapsed: horizon.days_elapsed,
      days_total: horizon.days_total,
    },
  };
}

function horizonProgress(investment: InvestmentRow, today: string) {
  const snapshot = snapshotOf(investment);
  const months = Math.max(
    1,
    Number(snapshot.terms_count) * Number(snapshot.months_per_term) + Number(snapshot.settlement_months)
  );
  const start = dateOnly(investment.start_date);
  const end = addMonths(start, months);
  const daysTotal = Math.max(1, daysBetween(start, end));
  const daysElapsed = Math.min(daysTotal, Math.max(0, daysBetween(start, today)));
  return { months, days_elapsed: daysElapsed, days_total: daysTotal };
}

export async function getInvestorMe(userId: string) {
  const investor = await ownInvestor(userId);
  const { data, error } = await supabaseAdmin
    .from('vlb_investments')
    .select('*')
    .eq('investor_id', investor.id)
    .order('start_date', { ascending: false });
  if (error) {
    logDb('list my investments', error);
    throw new VlbError(500, 'Could not load your investments.');
  }
  const investments = (data || []) as InvestmentRow[];
  const payouts = await loadPayouts(investments.map((row) => row.id));
  const byInvestment = new Map<string, PayoutRow[]>();
  for (const payout of payouts) {
    const list = byInvestment.get(payout.investment_id) || [];
    list.push(payout);
    byInvestment.set(payout.investment_id, list);
  }
  const today = todayAccra();
  const summaries = investments.map((row) => summarizeInvestment(row, byInvestment.get(row.id) || [], today));
  const live = summaries.filter((row) => row.status === 'active' || row.status === 'settlement');
  const featured = [...live]
    .filter((row) => row.next_payout)
    .sort((a, b) => {
      const dateCmp = (a.next_payout?.date || '').localeCompare(b.next_payout?.date || '');
      if (dateCmp !== 0) return dateCmp;
      return (a.next_payout?.period_no || 0) - (b.next_payout?.period_no || 0);
    })[0] || live[0] || null;
  const next = featured?.next_payout || null;
  return {
    investor_no: investor.investor_no,
    payout: presentPayoutDetails(investor, true),
    investments: summaries,
    summary: {
      total_invested_pesewas: live.reduce((sum, row) => sum + Number(row.principal_pesewas), 0),
      received_pesewas: summaries.reduce((sum, row) => sum + Number(row.totals_paid_pesewas), 0),
      scholar_fund_pesewas: summaries.reduce((sum, row) => sum + Number(row.scholar_fund_deducted_pesewas), 0),
      next_payout: next
        ? {
            investment_id: featured?.id || null,
            date: next.date,
            net_pesewas: next.net_pesewas,
          }
        : null,
      featured: featured
        ? {
            investment_id: featured.id,
            plan_name: featured.plan_name,
            horizon_months: featured.horizon_months,
            horizon_progress: featured.horizon_progress,
          }
        : null,
    },
  };
}

async function ownInvestment(userId: string, investmentId: string): Promise<{ investor: InvestorRow; investment: InvestmentRow }> {
  const investor = await ownInvestor(userId);
  const { data, error } = await supabaseAdmin
    .from('vlb_investments')
    .select('*')
    .eq('id', investmentId)
    .eq('investor_id', investor.id)
    .maybeSingle();
  if (error) {
    logDb('own investment', error);
    throw new VlbError(500, 'Could not load this investment.');
  }
  if (!data) throw new VlbError(404, 'Investment not found.');
  return { investor, investment: data as InvestmentRow };
}

export async function getMyInvestment(userId: string, investmentId: string) {
  const { investor, investment } = await ownInvestment(userId, investmentId);
  const [payouts, stars, bonuses] = await Promise.all([
    loadPayouts([investment.id]),
    loadStarRedemptions(investment.id),
    loadReferralBonuses(investment.id),
  ]);
  const today = todayAccra();
  return {
    investor_no: investor.investor_no,
    ...summarizeInvestment(investment, payouts, today),
    schedule: payouts.map(presentPayoutRow),
    star_redemptions: stars,
    referral_bonuses: bonuses,
  };
}

export function presentPayoutRow(row: PayoutRow) {
  return {
    id: row.id,
    type: row.type,
    term_no: row.term_no,
    period_no: row.period_no,
    due_date: dateOnly(row.due_date),
    gross_pesewas: Number(row.gross_pesewas),
    scholar_pesewas: Number(row.scholar_pesewas),
    net_pesewas: Number(row.net_pesewas),
    status: row.status,
    paid_at: row.paid_at,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
  };
}

async function loadStarRedemptions(investmentId: string) {
  const { data, error } = await supabaseAdmin
    .from('vlb_star_redemptions')
    .select('id, product_note, order_id, created_at')
    .eq('investment_id', investmentId)
    .order('created_at', { ascending: false });
  if (error) {
    logDb('star redemptions', error);
    throw new VlbError(500, 'Could not load this investment.');
  }
  return data || [];
}

async function loadReferralBonuses(investmentId: string) {
  const { data, error } = await supabaseAdmin
    .from('vlb_referral_bonuses')
    .select('id, referred_investment_id, bonus_percent, applied_from_period, created_at')
    .eq('referrer_investment_id', investmentId)
    .order('created_at', { ascending: false });
  if (error) {
    logDb('referral bonuses', error);
    throw new VlbError(500, 'Could not load this investment.');
  }
  return (data || []).map((row) => ({
    ...row,
    bonus_percent: Number(row.bonus_percent),
  }));
}

export async function chooseRenewal(
  req: AuditReq,
  userId: string,
  investmentId: string,
  choice: 'settle' | 'renew'
) {
  const { investor, investment } = await ownInvestment(userId, investmentId);
  if (investment.status !== 'active' && investment.status !== 'settlement') {
    throw new VlbError(400, 'This investment cannot change renewal choice.');
  }
  const today = todayAccra();
  const progress = termProgress(snapshotOf(investment), dateOnly(investment.start_date), today);
  if (!progress.renewal_open) {
    throw new VlbError(400, 'Renewal choice is only open in the last month of the final term.');
  }

  const { data, error } = await supabaseAdmin
    .from('vlb_investments')
    .update({
      renewal_choice: choice,
      renewal_chosen_at: new Date().toISOString(),
    })
    .eq('id', investment.id)
    .eq('investor_id', investor.id)
    .select('*')
    .single();
  if (error || !data) {
    logDb('renewal choice', error);
    throw new VlbError(500, 'Could not save your renewal choice.');
  }

  await logAudit({
    req,
    entity: 'vlb_investments',
    entityId: investment.id,
    action: 'vlb_renewal_choice',
    before: investment,
    after: data,
  });

  const user = await loadUser(userId);
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1A1A1A;">
      <h2 style="color:#FF7A19;">Laptop Banking renewal choice</h2>
      <p><strong>Investor:</strong> ${escapeHtml(investor.investor_no || investor.id)}</p>
      <p><strong>Name:</strong> ${escapeHtml(displayName(user))}</p>
      <p><strong>Investment:</strong> ${escapeHtml(investment.id)}</p>
      <p><strong>Choice:</strong> ${escapeHtml(choice)}</p>
    </div>
  `;
  const sent = await emailService.sendEmail({
    to: adminNotificationEmail,
    subject: `Laptop Banking renewal: ${choice}`,
    html,
  }, true);
  if (!sent) console.error('vlb renewal store email failed');

  return { renewal_choice: choice, renewal_chosen_at: data.renewal_chosen_at };
}

export async function createUpgradeRequest(
  req: AuditReq,
  userId: string,
  input: { requested_plan_id: string; message?: string | null }
) {
  const investor = await ownInvestor(userId);
  const { data: plan, error: planError } = await supabaseAdmin
    .from('vlb_plans')
    .select('id, name, is_active')
    .eq('id', input.requested_plan_id)
    .maybeSingle();
  if (planError) {
    logDb('load upgrade plan', planError);
    throw new VlbError(500, 'Could not save this upgrade request.');
  }
  if (!plan || !plan.is_active) throw new VlbError(400, 'That plan is not available.');

  const { data: current } = await supabaseAdmin
    .from('vlb_investments')
    .select('id')
    .eq('investor_id', investor.id)
    .in('status', ['active', 'settlement'])
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from('vlb_upgrade_requests')
    .insert({
      investor_id: investor.id,
      current_investment_id: current?.id || null,
      requested_plan_id: input.requested_plan_id,
      message: input.message?.trim() || null,
      status: 'new',
    })
    .select('*')
    .single();
  if (error || !data) {
    logDb('insert upgrade request', error);
    throw new VlbError(500, 'Could not save this upgrade request.');
  }

  await logAudit({
    req,
    entity: 'vlb_upgrade_requests',
    entityId: data.id,
    action: 'vlb_upgrade_requested',
    after: data,
  });

  const user = await loadUser(userId);
  const sent = await emailService.sendEmail({
    to: adminNotificationEmail,
    subject: 'Laptop Banking upgrade request',
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1A1A1A;">
        <h2 style="color:#FF7A19;">Laptop Banking upgrade request</h2>
        <p><strong>Investor:</strong> ${escapeHtml(investor.investor_no || investor.id)}</p>
        <p><strong>Name:</strong> ${escapeHtml(displayName(user))}</p>
        <p><strong>Requested plan:</strong> ${escapeHtml(plan.name)}</p>
        ${input.message ? `<p>${escapeHtml(input.message)}</p>` : ''}
      </div>
    `,
  }, true);
  if (!sent) console.error('vlb upgrade store email failed');

  return data;
}

export async function listMyDocuments(userId: string) {
  const investor = await ownInvestor(userId);
  const { data, error } = await supabaseAdmin
    .from('vlb_documents')
    .select('id, investment_id, kind, title, mime, size_bytes, created_at, r2_key')
    .eq('investor_id', investor.id)
    .order('created_at', { ascending: false });
  if (error) {
    logDb('list documents', error);
    throw new VlbError(500, 'Could not load your documents.');
  }
  const rows = [];
  for (const row of data || []) {
    let url: string | null = null;
    try {
      url = await getSignedViewUrl(row.r2_key, 600);
    } catch (signError) {
      logDb('sign document', signError);
    }
    rows.push({
      id: row.id,
      investment_id: row.investment_id,
      kind: row.kind,
      title: row.title,
      mime: row.mime,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
      url,
    });
  }
  return rows;
}

export async function statementPayload(userId: string, investmentId: string) {
  const { investor, investment } = await ownInvestment(userId, investmentId);
  const payouts = await loadPayouts([investment.id]);
  const user = await loadUser(userId);
  const paid = payouts.filter((row) => row.status === 'paid');
  const open = payouts.filter((row) => row.status !== 'paid');
  return {
    investor_name: displayName(user),
    investor_no: investor.investor_no || investor.id,
    plan_name: planNameOf(investment),
    principal_pesewas: Number(investment.principal_pesewas),
    start_date: dateOnly(investment.start_date),
    maturity_date: dateOnly(investment.maturity_date),
    status: investment.status,
    payouts: payouts.map((row) => ({
      type: row.type,
      term_no: row.term_no,
      period_no: row.period_no,
      due_date: dateOnly(row.due_date),
      gross_pesewas: Number(row.gross_pesewas),
      scholar_pesewas: Number(row.scholar_pesewas),
      net_pesewas: Number(row.net_pesewas),
      status: row.status,
      paid_at: row.paid_at,
      reference: row.reference,
    })),
    totals: {
      paid_net_pesewas: paid.reduce((sum, row) => sum + Number(row.net_pesewas), 0),
      scholar_pesewas: paid.reduce((sum, row) => sum + Number(row.scholar_pesewas), 0),
      scheduled_net_pesewas: open.reduce((sum, row) => sum + Number(row.net_pesewas), 0),
    },
  };
}

function sameText(left: unknown, right: unknown): boolean {
  return (typeof left === 'string' ? left : '') === (typeof right === 'string' ? right : '');
}

function payoutFieldsChanged(row: InvestorRow, input: PayoutInput): boolean {
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

export async function updateInvestorPayout(req: AuditReq, userId: string, input: PayoutInput) {
  const row = await ownInvestor(userId);
  const changed = payoutFieldsChanged(row, input);
  if (!changed) return presentPayoutDetails(row, true);

  const now = new Date().toISOString();
  const patch = input.payout_method === 'momo'
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
    .from('investors')
    .update(patch)
    .eq('id', row.id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error || !data) {
    logDb('update payout', error);
    throw new VlbError(500, 'Could not update payout details.');
  }

  await logAudit({
    req,
    entity: 'investors',
    entityId: row.id,
    action: 'vlb_payout_updated',
    before: row,
    after: data,
  });

  const user = await loadUser(userId);
  if (user?.email) {
    const sent = await emailService.sendEmail({
      to: user.email,
      subject: 'Your payout details were changed',
      html: `
        <p>Hi ${escapeHtml(displayName(user))},</p>
        <p>Your Laptop Banking payout details were changed.</p>
        <p>If you did not make this change, contact support.</p>
        <p>VENTECH Gadgets</p>
      `,
    }, false);
    if (!sent) console.error('vlb payout changed email failed');
  }

  return presentPayoutDetails(data as InvestorRow, true);
}
