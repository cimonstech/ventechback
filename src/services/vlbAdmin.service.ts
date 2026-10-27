import { randomUUID } from 'crypto';
import { Request } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { logAudit } from './audit.service';
import { emailService } from './email.service';
import { deletePrivateObject, getSignedViewUrl, putPrivateObject } from './privateStorage.service';
import { detectTicketFile } from './ticketFiles';
import { loadPlan, VlbError } from './vlb.service';
import {
  InvestmentRow,
  InvestorRow,
  PayoutRow,
  loadInvestorById,
  loadPayouts,
  presentPayoutDetails,
  presentPayoutRow,
} from './vlbInvestor.service';
import {
  addDays,
  addMonths,
  buildSchedule,
  extraRateMap,
  planSnapshotFields,
  snapshotFromPlan,
  termProgress,
  todayAccra,
} from './vlbCalc.service';

type AuditReq = Request & { user?: { id?: string; role?: string } };

const APP_STATUSES = ['new', 'contacted', 'activated', 'declined'] as const;
const INVESTMENT_STATUSES = ['active', 'settlement', 'settled', 'renewed'] as const;
const UPGRADE_STATUSES = ['new', 'contacted', 'done', 'declined'] as const;
const DOC_KINDS = ['agreement', 'receipt', 'statement', 'other'] as const;
const IMAGE_LIMIT = 10 * 1024 * 1024;

function logDb(scope: string, error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : String(error);
  console.error(`vlb admin ${scope}`, message);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dateOnly(value: unknown): string {
  return String(value || '').slice(0, 10);
}

function pesewasLabel(pesewas: number): string {
  return `GHS ${(Number(pesewas) / 100).toFixed(2)}`;
}

function rpcMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message || '');
  }
  return '';
}

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvTable(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvEscape).join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n');
}

async function loadUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, first_name, last_name, full_name, phone')
    .eq('id', userId)
    .maybeSingle();
  if (error) logDb('load user', error);
  return data;
}

function displayName(user: { full_name?: string | null; first_name?: string | null; last_name?: string | null } | null): string {
  if (!user) return 'there';
  return user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'there';
}

function snapshotOf(investment: InvestmentRow) {
  return snapshotFromPlan(investment.plan_snapshot as Parameters<typeof snapshotFromPlan>[0]);
}

function planNameOf(investment: InvestmentRow): string {
  const snap = investment.plan_snapshot as { name?: string };
  return snap?.name || 'Laptop Banking';
}

async function loadInvestment(id: string): Promise<InvestmentRow> {
  const { data, error } = await supabaseAdmin
    .from('vlb_investments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logDb('load investment', error);
    throw new VlbError(500, 'Could not load this investment.');
  }
  if (!data) throw new VlbError(404, 'Investment not found.');
  return data as InvestmentRow;
}

export async function listApplications(input: { page: number; limit: number; status?: string }) {
  if (input.status && !APP_STATUSES.includes(input.status as (typeof APP_STATUSES)[number])) {
    throw new VlbError(400, 'That status is not available.');
  }
  const from = (input.page - 1) * input.limit;
  const to = from + input.limit - 1;
  let query = supabaseAdmin
    .from('vlb_applications')
    .select('*, vlb_plans(name, plan_group, tier, version)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (input.status) query = query.eq('status', input.status);
  const { data, error, count } = await query;
  if (error) {
    logDb('list applications', error);
    throw new VlbError(500, 'Could not load applications.');
  }
  return { rows: data || [], total: count || 0 };
}

export async function getApplication(id: string) {
  const { data, error } = await supabaseAdmin
    .from('vlb_applications')
    .select('*, vlb_plans(name, plan_group, tier, version, principal_pesewas)')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logDb('get application', error);
    throw new VlbError(500, 'Could not load this application.');
  }
  if (!data) throw new VlbError(404, 'Application not found.');
  return data;
}

export async function patchApplication(
  req: AuditReq,
  id: string,
  input: { status?: 'new' | 'contacted' | 'declined'; notes?: string | null }
) {
  const current = await getApplication(id);
  if (current.status === 'activated' && input.status) {
    throw new VlbError(400, 'An activated application cannot change status.');
  }
  if (input.status === undefined && input.notes === undefined) {
    throw new VlbError(400, 'Nothing to update.');
  }
  const patch: Record<string, unknown> = {};
  if (input.status) {
    patch.status = input.status;
    patch.handled_by = req.user?.id || null;
  }
  if (input.notes !== undefined) patch.notes = input.notes;
  const { data, error } = await supabaseAdmin
    .from('vlb_applications')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) {
    logDb('patch application', error);
    throw new VlbError(500, 'Could not update this application.');
  }
  await logAudit({
    req,
    entity: 'vlb_applications',
    entityId: id,
    action: 'vlb_application_updated',
    before: current,
    after: data,
  });
  return data;
}

export async function listInvestors(input: { page: number; limit: number; search?: string }) {
  const from = (input.page - 1) * input.limit;
  const to = from + input.limit - 1;
  let query = supabaseAdmin
    .from('investors')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (input.search) {
    const search = input.search.replace(/[%_,]/g, '').trim();
    if (search) query = query.ilike('investor_no', `%${search}%`);
  }
  const { data, error, count } = await query;
  if (error) {
    logDb('list investors', error);
    throw new VlbError(500, 'Could not load investors.');
  }
  const rows = (data || []) as InvestorRow[];
  const users = await Promise.all(rows.map((row) => loadUser(row.user_id)));
  return {
    rows: rows.map((row, index) => ({
      id: row.id,
      investor_no: row.investor_no,
      user_id: row.user_id,
      name: displayName(users[index]),
      email: users[index]?.email || null,
      payout_method: row.payout_method,
      created_at: (row as InvestorRow & { created_at?: string }).created_at,
    })),
    total: count || 0,
  };
}

export async function getInvestorAdmin(id: string, unmaskPayout: boolean) {
  const investor = await loadInvestorById(id);
  const user = await loadUser(investor.user_id);
  const { data: investments, error } = await supabaseAdmin
    .from('vlb_investments')
    .select('*')
    .eq('investor_id', investor.id)
    .order('start_date', { ascending: false });
  if (error) {
    logDb('investor investments', error);
    throw new VlbError(500, 'Could not load this investor.');
  }
  const { data: documents, error: docError } = await supabaseAdmin
    .from('vlb_documents')
    .select('id, investment_id, kind, title, mime, size_bytes, created_at, r2_key')
    .eq('investor_id', investor.id)
    .order('created_at', { ascending: false });
  if (docError) {
    logDb('investor documents', docError);
    throw new VlbError(500, 'Could not load this investor.');
  }
  const docs = [];
  for (const row of documents || []) {
    let url: string | null = null;
    try {
      url = await getSignedViewUrl(row.r2_key, 600);
    } catch (signError) {
      logDb('sign document', signError);
    }
    docs.push({
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
  const today = todayAccra();
  const list = (investments || []) as InvestmentRow[];
  const payouts = await loadPayouts(list.map((row) => row.id));
  const byId = new Map<string, PayoutRow[]>();
  for (const payout of payouts) {
    const group = byId.get(payout.investment_id) || [];
    group.push(payout);
    byId.set(payout.investment_id, group);
  }
  return {
    id: investor.id,
    investor_no: investor.investor_no,
    user_id: investor.user_id,
    name: displayName(user),
    email: user?.email || null,
    phone: user?.phone || null,
    payout: presentPayoutDetails(investor, !unmaskPayout),
    investments: list.map((row) => {
      const progress = termProgress(snapshotOf(row), dateOnly(row.start_date), today);
      return {
        id: row.id,
        plan_name: planNameOf(row),
        principal_pesewas: Number(row.principal_pesewas),
        start_date: dateOnly(row.start_date),
        maturity_date: dateOnly(row.maturity_date),
        status: row.status,
        current_term: progress.current_term,
        renewal_choice: row.renewal_choice,
        stars_total: Number(row.stars_total),
        stars_used: Number(row.stars_used),
      };
    }),
    documents: docs,
  };
}

export async function listInvestments(input: {
  page: number;
  limit: number;
  plan_id?: string;
  status?: string;
  term?: number;
  maturity_month?: string;
}) {
  if (input.status && !INVESTMENT_STATUSES.includes(input.status as (typeof INVESTMENT_STATUSES)[number])) {
    throw new VlbError(400, 'That status is not available.');
  }
  const from = (input.page - 1) * input.limit;
  const to = from + input.limit - 1;
  let query = supabaseAdmin
    .from('vlb_investments')
    .select('*, investors(investor_no, user_id)', { count: 'exact' })
    .order('start_date', { ascending: false });
  if (input.plan_id) query = query.eq('plan_id', input.plan_id);
  if (input.status) query = query.eq('status', input.status);
  if (input.maturity_month && /^\d{4}-\d{2}$/.test(input.maturity_month)) {
    const start = `${input.maturity_month}-01`;
    const end = addMonths(start, 1);
    query = query.gte('maturity_date', start).lt('maturity_date', end);
  }
  if (!input.term) query = query.range(from, to);
  const { data, error, count } = await query;
  if (error) {
    logDb('list investments', error);
    throw new VlbError(500, 'Could not load investments.');
  }
  const today = todayAccra();
  let rows = (data || []) as Array<InvestmentRow & { investors?: { investor_no: string | null; user_id: string } }>;
  if (input.term) {
    rows = rows.filter((row) => {
      const progress = termProgress(snapshotOf(row), dateOnly(row.start_date), today);
      return progress.current_term === input.term;
    });
  }
  const total = input.term ? rows.length : count || 0;
  const pageRows = input.term ? rows.slice(from, from + input.limit) : rows;
  return {
    rows: pageRows.map((row) => {
      const progress = termProgress(snapshotOf(row), dateOnly(row.start_date), today);
      return {
        id: row.id,
        investor_id: row.investor_id,
        investor_no: row.investors?.investor_no || null,
        plan_id: row.plan_id,
        plan_name: planNameOf(row),
        principal_pesewas: Number(row.principal_pesewas),
        start_date: dateOnly(row.start_date),
        maturity_date: dateOnly(row.maturity_date),
        status: row.status,
        current_term: progress.current_term,
        renewal_choice: row.renewal_choice,
      };
    }),
    total,
  };
}

export async function getInvestmentAdmin(id: string) {
  const investment = await loadInvestment(id);
  const investor = await loadInvestorById(investment.investor_id);
  const [payouts, stars, bonuses] = await Promise.all([
    loadPayouts([investment.id]),
    supabaseAdmin
      .from('vlb_star_redemptions')
      .select('id, product_note, order_id, created_at')
      .eq('investment_id', investment.id)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('vlb_referral_bonuses')
      .select('id, referred_investment_id, bonus_percent, applied_from_period, created_at')
      .eq('referrer_investment_id', investment.id)
      .order('created_at', { ascending: false }),
  ]);
  if (stars.error) {
    logDb('investment stars', stars.error);
    throw new VlbError(500, 'Could not load this investment.');
  }
  if (bonuses.error) {
    logDb('investment bonuses', bonuses.error);
    throw new VlbError(500, 'Could not load this investment.');
  }
  const today = todayAccra();
  const progress = termProgress(snapshotOf(investment), dateOnly(investment.start_date), today);
  return {
    ...investment,
    principal_pesewas: Number(investment.principal_pesewas),
    start_date: dateOnly(investment.start_date),
    maturity_date: dateOnly(investment.maturity_date),
    plan_name: planNameOf(investment),
    investor_no: investor.investor_no,
    current_term: progress.current_term,
    term_progress: {
      days_elapsed: progress.days_elapsed,
      days_total: progress.days_total,
    },
    schedule: payouts.map(presentPayoutRow),
    star_redemptions: stars.data || [],
    referral_bonuses: (bonuses.data || []).map((row) => ({
      ...row,
      bonus_percent: Number(row.bonus_percent),
    })),
  };
}

function weekBounds(today: string): { start: string; end: string } {
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  date.setUTCDate(date.getUTCDate() - offset);
  const start = date.toISOString().slice(0, 10);
  return { start, end: addDays(start, 6) };
}

export async function listPayoutQueue(input: {
  range: 'this_week' | 'overdue' | 'due' | 'all' | 'paid';
  page: number;
  limit: number;
}) {
  const today = todayAccra();
  const from = (input.page - 1) * input.limit;
  const to = from + input.limit - 1;
  let query = supabaseAdmin
    .from('vlb_payouts')
    .select('*, vlb_investments(id, status, renewal_choice, investor_id, plan_snapshot, investors(investor_no))', { count: 'exact' });

  if (input.range === 'due') {
    query = query.eq('status', 'due').order('due_date', { ascending: true });
  } else if (input.range === 'overdue') {
    query = query.in('status', ['due', 'processing']).lt('due_date', today).order('due_date', { ascending: true });
  } else if (input.range === 'this_week') {
    const week = weekBounds(today);
    query = query.gte('due_date', week.start).lte('due_date', week.end).in('status', ['scheduled', 'due', 'processing']).order('due_date', { ascending: true });
  } else if (input.range === 'paid') {
    query = query.eq('status', 'paid').order('paid_at', { ascending: false });
  } else {
    query = query.in('status', ['scheduled', 'due', 'processing']).order('due_date', { ascending: true });
  }
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    logDb('payout queue', error);
    throw new VlbError(500, 'Could not load payouts.');
  }
  return { rows: data || [], total: count || 0 };
}

export async function markPayoutPaid(
  req: AuditReq,
  payoutId: string,
  input: { method: string; reference: string; paid_at?: string }
) {
  const { data: payout, error } = await supabaseAdmin
    .from('vlb_payouts')
    .select('*')
    .eq('id', payoutId)
    .maybeSingle();
  if (error) {
    logDb('load payout', error);
    throw new VlbError(500, 'Could not update this payout.');
  }
  if (!payout) throw new VlbError(404, 'Payout not found.');
  if (payout.status !== 'due' && payout.status !== 'processing') {
    throw new VlbError(400, 'Only due or processing payouts can be marked paid.');
  }

  const investment = await loadInvestment(payout.investment_id);
  if (payout.type === 'principal') {
    if (investment.status !== 'settlement' || investment.renewal_choice !== 'settle') {
      throw new VlbError(400, 'Principal can only be paid during settlement when the choice is to settle.');
    }
  }

  const paidAt = input.paid_at ? new Date(input.paid_at).toISOString() : new Date().toISOString();
  const { data, error: updateError } = await supabaseAdmin
    .from('vlb_payouts')
    .update({
      status: 'paid',
      method: input.method,
      reference: input.reference,
      paid_at: paidAt,
      recorded_by: req.user?.id || null,
    })
    .eq('id', payoutId)
    .in('status', ['due', 'processing'])
    .select('*')
    .maybeSingle();
  if (updateError) {
    logDb('mark paid', updateError);
    throw new VlbError(500, 'Could not update this payout.');
  }
  if (!data) throw new VlbError(409, 'This payout was already updated.');

  await logAudit({
    req,
    entity: 'vlb_payouts',
    entityId: payoutId,
    action: 'vlb_payout_marked_paid',
    before: payout,
    after: data,
  });

  const investor = await loadInvestorById(investment.investor_id);
  const user = await loadUser(investor.user_id);
  if (user?.email) {
    const periodLabel = payout.type === 'principal' ? 'principal repayment' : `period ${payout.period_no}`;
    const sent = await emailService.sendEmail({
      to: user.email,
      subject: `Payment sent: ${pesewasLabel(Number(payout.net_pesewas))} (net) for ${periodLabel}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1A1A1A;">
          <h2 style="color:#FF7A19;">Payment sent</h2>
          <p>Hi ${escapeHtml(displayName(user))},</p>
          <p>We sent ${escapeHtml(pesewasLabel(Number(payout.net_pesewas)))} (net) for ${escapeHtml(periodLabel)}.</p>
          <p><strong>Gross:</strong> ${escapeHtml(pesewasLabel(Number(payout.gross_pesewas)))}<br>
             <strong>Scholar Fund:</strong> ${escapeHtml(pesewasLabel(Number(payout.scholar_pesewas)))}<br>
             <strong>Net:</strong> ${escapeHtml(pesewasLabel(Number(payout.net_pesewas)))}</p>
          <p><strong>Method:</strong> ${escapeHtml(input.method)}<br>
             <strong>Reference:</strong> ${escapeHtml(input.reference)}</p>
          <p>VENTECH Gadgets</p>
        </div>
      `,
    }, true);
    if (!sent) console.error('vlb payment sent email failed');
  }

  return presentPayoutRow(data as PayoutRow);
}

export async function listSettlementQueue() {
  const { data, error } = await supabaseAdmin
    .from('vlb_investments')
    .select('*, investors(investor_no, user_id)')
    .eq('status', 'settlement')
    .order('maturity_date', { ascending: true });
  if (error) {
    logDb('settlement queue', error);
    throw new VlbError(500, 'Could not load the settlement queue.');
  }
  const rows = (data || []) as Array<InvestmentRow & { investors?: { investor_no: string | null } }>;
  const payouts = await loadPayouts(rows.map((row) => row.id));
  const principalById = new Map<string, PayoutRow>();
  for (const payout of payouts) {
    if (payout.type === 'principal') principalById.set(payout.investment_id, payout);
  }
  return rows.map((row) => ({
    id: row.id,
    investor_id: row.investor_id,
    investor_no: row.investors?.investor_no || null,
    plan_name: planNameOf(row),
    principal_pesewas: Number(row.principal_pesewas),
    start_date: dateOnly(row.start_date),
    maturity_date: dateOnly(row.maturity_date),
    renewal_choice: row.renewal_choice,
    renewal_chosen_at: row.renewal_chosen_at,
    principal_payout: principalById.get(row.id) ? presentPayoutRow(principalById.get(row.id) as PayoutRow) : null,
  }));
}

export async function settleInvestment(req: AuditReq, investmentId: string) {
  const investment = await loadInvestment(investmentId);
  if (investment.status !== 'settlement') {
    throw new VlbError(400, 'This investment is not in settlement.');
  }
  if (investment.renewal_choice !== 'settle') {
    throw new VlbError(400, 'This investor chose to renew.');
  }
  const payouts = await loadPayouts([investment.id]);
  const principal = payouts.find((row) => row.type === 'principal');
  if (!principal || principal.status !== 'paid') {
    throw new VlbError(400, 'The principal payout must be marked paid first.');
  }

  const { data, error } = await supabaseAdmin
    .from('vlb_investments')
    .update({ status: 'settled' })
    .eq('id', investment.id)
    .eq('status', 'settlement')
    .select('*')
    .maybeSingle();
  if (error) {
    logDb('settle', error);
    throw new VlbError(500, 'Could not settle this investment.');
  }
  if (!data) throw new VlbError(409, 'This investment was already updated.');

  await logAudit({
    req,
    entity: 'vlb_investments',
    entityId: investment.id,
    action: 'vlb_investment_settled',
    before: investment,
    after: data,
  });
  return data;
}

async function loadCurrentPlanVersion(planGroup: string, tier: string) {
  const { data, error } = await supabaseAdmin
    .from('vlb_plans')
    .select('*')
    .eq('plan_group', planGroup)
    .eq('tier', tier)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logDb('current plan version', error);
    throw new VlbError(500, 'Could not renew this investment.');
  }
  if (!data) throw new VlbError(400, 'No active plan version is available for renewal.');
  return data;
}

export async function renewInvestment(req: AuditReq, investmentId: string) {
  const old = await loadInvestment(investmentId);
  if (old.status !== 'settlement') {
    throw new VlbError(400, 'This investment is not in settlement.');
  }
  if (old.renewal_choice !== 'renew') {
    throw new VlbError(400, 'This investor chose to settle.');
  }

  const oldPlan = await loadPlan(old.plan_id);
  const currentPlan = await loadCurrentPlanVersion(oldPlan.plan_group, oldPlan.tier);
  const startDate = addDays(dateOnly(old.maturity_date), 1);
  const snapshot = snapshotFromPlan(currentPlan);
  const schedule = buildSchedule(snapshot, Number(old.principal_pesewas), startDate);
  const maturityDate = schedule.find((row) => row.type === 'principal')?.due_date
    || addMonths(startDate, snapshot.terms_count * snapshot.months_per_term + snapshot.settlement_months);
  const planSnapshot = {
    ...planSnapshotFields(currentPlan),
    principal_pesewas: Number(old.principal_pesewas),
  };

  const { data, error } = await supabaseAdmin.rpc('renew_vlb_investment', {
    p_old_investment_id: old.id,
    p_new_plan_id: currentPlan.id,
    p_principal_pesewas: Number(old.principal_pesewas),
    p_start_date: startDate,
    p_maturity_date: maturityDate,
    p_plan_snapshot: planSnapshot,
    p_payouts: schedule,
    p_stars_total: Number(currentPlan.premium_stars),
    p_renewed_by: req.user?.id || null,
  });

  if (error) {
    const message = rpcMessage(error);
    logDb('renew_vlb_investment', error);
    if (message.includes('not found')) throw new VlbError(404, 'Investment not found.');
    if (message.includes('already renewed')) throw new VlbError(409, 'This investment is already renewed.');
    if (message.includes('already settled')) throw new VlbError(409, 'This investment is already settled.');
    if (message.includes('not in settlement')) throw new VlbError(400, 'This investment is not in settlement.');
    if (message.includes('chose to settle')) throw new VlbError(400, 'This investor chose to settle.');
    if (message.includes('already paid out')) throw new VlbError(400, 'Principal was already paid out.');
    if (message.includes('Plan not found')) throw new VlbError(404, 'Plan not found.');
    throw new VlbError(500, 'Could not renew this investment.');
  }

  const result = data as { old_investment_id: string; new_investment_id: string };
  await logAudit({
    req,
    entity: 'vlb_investments',
    entityId: result.new_investment_id,
    action: 'vlb_investment_renewed',
    before: old,
    after: result,
  });
  return { ...result, start_date: startDate, maturity_date: maturityDate, plan_id: currentPlan.id };
}

export async function recordStarRedemption(
  req: AuditReq,
  investmentId: string,
  input: { product_note: string; order_id?: string | null }
) {
  if (input.order_id) {
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('id', input.order_id)
      .maybeSingle();
    if (error) {
      logDb('load order for star', error);
      throw new VlbError(500, 'Could not record this redemption.');
    }
    if (!order) throw new VlbError(400, 'Order not found.');
  }

  const before = await loadInvestment(investmentId);
  const { data, error } = await supabaseAdmin.rpc('record_vlb_star_redemption', {
    p_investment_id: investmentId,
    p_product_note: input.product_note,
    p_order_id: input.order_id || null,
    p_recorded_by: req.user?.id || null,
  });
  if (error) {
    const message = rpcMessage(error);
    logDb('record_vlb_star_redemption', error);
    if (message.includes('not found')) throw new VlbError(404, 'Investment not found.');
    if (message.includes('No stars remain')) throw new VlbError(400, 'No stars remain.');
    if (message.includes('Product note')) throw new VlbError(400, 'Product note is required.');
    throw new VlbError(500, 'Could not record this redemption.');
  }

  await logAudit({
    req,
    entity: 'vlb_star_redemptions',
    entityId: (data as { id: string }).id,
    action: 'vlb_star_redeemed',
    before: { stars_used: before.stars_used, stars_total: before.stars_total },
    after: data,
  });
  return data;
}

export async function applyReferralBonus(
  req: AuditReq,
  referrerInvestmentId: string,
  referredInvestmentId: string
) {
  if (referrerInvestmentId === referredInvestmentId) {
    throw new VlbError(400, 'A referral cannot point at the same investment.');
  }
  const referrer = await loadInvestment(referrerInvestmentId);
  const referred = await loadInvestment(referredInvestmentId);
  if (!referred) throw new VlbError(404, 'Referred investment not found.');

  const snapshot = snapshotOf(referrer);
  const bonusPercent = Number((referrer.plan_snapshot as { referral_bonus_percent?: number | string }).referral_bonus_percent ?? 0);
  if (!Number.isFinite(bonusPercent) || bonusPercent <= 0) {
    throw new VlbError(400, 'This plan has no referral bonus.');
  }

  const payouts = await loadPayouts([referrer.id]);
  const unpaidReturns = payouts
    .filter((row) => row.type === 'return' && row.status !== 'paid')
    .sort((a, b) => a.period_no - b.period_no);
  if (unpaidReturns.length === 0) {
    throw new VlbError(400, 'There is no unpaid return period left to apply a bonus.');
  }
  const appliedFrom = unpaidReturns[0].period_no;

  const { data: bonus, error: bonusError } = await supabaseAdmin
    .from('vlb_referral_bonuses')
    .insert({
      referrer_investment_id: referrer.id,
      referred_investment_id: referred.id,
      bonus_percent: bonusPercent,
      applied_from_period: appliedFrom,
      recorded_by: req.user?.id || null,
    })
    .select('*')
    .single();
  if (bonusError || !bonus) {
    logDb('insert referral bonus', bonusError);
    if ((bonusError as { code?: string } | null)?.code === '23505') {
      throw new VlbError(409, 'This referred investment already has a bonus.');
    }
    throw new VlbError(500, 'Could not apply this referral bonus.');
  }

  const { data: allBonuses, error: listError } = await supabaseAdmin
    .from('vlb_referral_bonuses')
    .select('applied_from_period, bonus_percent')
    .eq('referrer_investment_id', referrer.id);
  if (listError) {
    logDb('list referral bonuses', listError);
    throw new VlbError(500, 'Could not apply this referral bonus.');
  }

  const extra = extraRateMap(allBonuses || [], 0);
  const rebuilt = buildSchedule(snapshot, Number(referrer.principal_pesewas), dateOnly(referrer.start_date), extra);
  const beforeAmounts = unpaidReturns.map((row) => ({
    id: row.id,
    period_no: row.period_no,
    gross_pesewas: Number(row.gross_pesewas),
    scholar_pesewas: Number(row.scholar_pesewas),
    net_pesewas: Number(row.net_pesewas),
  }));
  const afterAmounts = [];

  for (const row of unpaidReturns) {
    const next = rebuilt.find((item) => item.type === 'return' && item.period_no === row.period_no);
    if (!next) continue;
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('vlb_payouts')
      .update({
        gross_pesewas: next.gross_pesewas,
        scholar_pesewas: next.scholar_pesewas,
        net_pesewas: next.net_pesewas,
      })
      .eq('id', row.id)
      .neq('status', 'paid')
      .select('id, period_no, gross_pesewas, scholar_pesewas, net_pesewas')
      .maybeSingle();
    if (updateError) {
      logDb('recalc unpaid return', updateError);
      throw new VlbError(500, 'Could not apply this referral bonus.');
    }
    if (updated) afterAmounts.push(updated);
  }

  await logAudit({
    req,
    entity: 'vlb_referral_bonuses',
    entityId: bonus.id,
    action: 'vlb_referral_bonus_applied',
    before: beforeAmounts,
    after: { bonus, payouts: afterAmounts },
  });

  return {
    bonus,
    applied_from_period: appliedFrom,
    before: beforeAmounts,
    after: afterAmounts,
  };
}

export async function uploadInvestorDocument(
  req: AuditReq,
  investorId: string,
  input: {
    file: { buffer: Buffer; size: number };
    kind: (typeof DOC_KINDS)[number];
    title: string;
    investment_id?: string | null;
  }
) {
  const investor = await loadInvestorById(investorId);
  const detected = detectTicketFile(input.file.buffer);
  if (!detected || detected.group === 'video') {
    throw new VlbError(400, 'Upload a PDF or an image.');
  }
  if (input.file.size > IMAGE_LIMIT) {
    throw new VlbError(400, 'Files must be 10 MB or smaller.');
  }
  if (input.investment_id) {
    const investment = await loadInvestment(input.investment_id);
    if (investment.investor_id !== investor.id) {
      throw new VlbError(400, 'That investment does not belong to this investor.');
    }
  }

  const key = `vlb/${investor.id}/${randomUUID()}.${detected.ext}`;
  try {
    await putPrivateObject(key, input.file.buffer, detected.mime);
  } catch (error) {
    logDb('document store', error);
    throw new VlbError(500, 'Could not store this file.');
  }

  const { data, error } = await supabaseAdmin
    .from('vlb_documents')
    .insert({
      investor_id: investor.id,
      investment_id: input.investment_id || null,
      kind: input.kind,
      title: input.title.trim(),
      r2_key: key,
      mime: detected.mime,
      size_bytes: input.file.size,
      uploaded_by: req.user?.id || null,
    })
    .select('id, investor_id, investment_id, kind, title, mime, size_bytes, created_at, r2_key')
    .single();
  if (error || !data) {
    logDb('document insert', error);
    try {
      await deletePrivateObject(key);
    } catch (cleanup) {
      logDb('document cleanup', cleanup);
    }
    throw new VlbError(500, 'Could not store this file.');
  }

  await logAudit({
    req,
    entity: 'vlb_documents',
    entityId: data.id,
    action: 'vlb_document_uploaded',
    after: { id: data.id, kind: data.kind, title: data.title, investor_id: investor.id },
  });

  let url: string | null = null;
  try {
    url = await getSignedViewUrl(data.r2_key, 600);
  } catch (signError) {
    logDb('sign uploaded document', signError);
  }
  return {
    id: data.id,
    investor_id: data.investor_id,
    investment_id: data.investment_id,
    kind: data.kind,
    title: data.title,
    mime: data.mime,
    size_bytes: data.size_bytes,
    created_at: data.created_at,
    url,
  };
}

export async function deleteInvestorDocument(req: AuditReq, documentId: string) {
  const { data, error } = await supabaseAdmin
    .from('vlb_documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle();
  if (error) {
    logDb('load document', error);
    throw new VlbError(500, 'Could not delete this document.');
  }
  if (!data) throw new VlbError(404, 'Document not found.');

  const { error: deleteError } = await supabaseAdmin.from('vlb_documents').delete().eq('id', documentId);
  if (deleteError) {
    logDb('delete document', deleteError);
    throw new VlbError(500, 'Could not delete this document.');
  }
  try {
    await deletePrivateObject(data.r2_key);
  } catch (storageError) {
    logDb('delete document storage', storageError);
  }
  await logAudit({
    req,
    entity: 'vlb_documents',
    entityId: documentId,
    action: 'vlb_document_deleted',
    before: { id: data.id, kind: data.kind, title: data.title, investor_id: data.investor_id },
  });
  return { id: documentId };
}

export async function listUpgradeRequests(input: { page: number; limit: number; status?: string }) {
  if (input.status && !UPGRADE_STATUSES.includes(input.status as (typeof UPGRADE_STATUSES)[number])) {
    throw new VlbError(400, 'That status is not available.');
  }
  const from = (input.page - 1) * input.limit;
  const to = from + input.limit - 1;
  let query = supabaseAdmin
    .from('vlb_upgrade_requests')
    .select('*, investors(investor_no), vlb_plans(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (input.status) query = query.eq('status', input.status);
  const { data, error, count } = await query;
  if (error) {
    logDb('list upgrades', error);
    throw new VlbError(500, 'Could not load upgrade requests.');
  }
  return { rows: data || [], total: count || 0 };
}

export async function patchUpgradeRequest(
  req: AuditReq,
  id: string,
  input: { status: 'new' | 'contacted' | 'done' | 'declined' }
) {
  const { data: current, error: loadError } = await supabaseAdmin
    .from('vlb_upgrade_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (loadError) {
    logDb('load upgrade', loadError);
    throw new VlbError(500, 'Could not update this upgrade request.');
  }
  if (!current) throw new VlbError(404, 'Upgrade request not found.');

  const { data, error } = await supabaseAdmin
    .from('vlb_upgrade_requests')
    .update({
      status: input.status,
      handled_by: req.user?.id || null,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) {
    logDb('patch upgrade', error);
    throw new VlbError(500, 'Could not update this upgrade request.');
  }
  await logAudit({
    req,
    entity: 'vlb_upgrade_requests',
    entityId: id,
    action: 'vlb_upgrade_updated',
    before: current,
    after: data,
  });
  return data;
}

function inRange(value: string | null, from: string, to: string): boolean {
  if (!value) return false;
  const day = dateOnly(value);
  return day >= from && day <= to;
}

export async function scholarFundReport(from: string, to: string) {
  const { data, error } = await supabaseAdmin
    .from('vlb_payouts')
    .select('id, scholar_pesewas, paid_at, due_date, investment_id, vlb_investments(investor_id, investors(investor_no, user_id))')
    .eq('status', 'paid')
    .gt('scholar_pesewas', 0);
  if (error) {
    logDb('scholar report', error);
    throw new VlbError(500, 'Could not load this report.');
  }
  const rows = (data || []).filter((row) => inRange(row.paid_at || row.due_date, from, to));
  const byMonth = new Map<string, { scholar_pesewas: number; count: number }>();
  const byInvestor = new Map<string, { investor_id: string; investor_no: string | null; scholar_pesewas: number; count: number }>();
  for (const row of rows) {
    const day = dateOnly(row.paid_at || row.due_date);
    const month = day.slice(0, 7);
    const monthAcc = byMonth.get(month) || { scholar_pesewas: 0, count: 0 };
    monthAcc.scholar_pesewas += Number(row.scholar_pesewas);
    monthAcc.count += 1;
    byMonth.set(month, monthAcc);

    const inv = row.vlb_investments as { investor_id?: string; investors?: { investor_no?: string | null } } | null;
    const investorId = inv?.investor_id || 'unknown';
    const acc = byInvestor.get(investorId) || {
      investor_id: investorId,
      investor_no: inv?.investors?.investor_no || null,
      scholar_pesewas: 0,
      count: 0,
    };
    acc.scholar_pesewas += Number(row.scholar_pesewas);
    acc.count += 1;
    byInvestor.set(investorId, acc);
  }
  const totals = {
    scholar_pesewas: rows.reduce((sum, row) => sum + Number(row.scholar_pesewas), 0),
    count: rows.length,
  };
  return {
    from,
    to,
    by_month: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => ({ month, ...value })),
    by_investor: [...byInvestor.values()].sort((a, b) => b.scholar_pesewas - a.scholar_pesewas),
    totals,
  };
}

export async function payoutsReport(from: string, to: string) {
  const { data, error } = await supabaseAdmin
    .from('vlb_payouts')
    .select('id, type, period_no, due_date, paid_at, gross_pesewas, scholar_pesewas, net_pesewas, method, reference, status, vlb_investments(investors(investor_no))')
    .eq('status', 'paid');
  if (error) {
    logDb('payouts report', error);
    throw new VlbError(500, 'Could not load this report.');
  }
  const rows = (data || [])
    .filter((row) => inRange(row.paid_at || row.due_date, from, to))
    .map((row) => {
      const inv = row.vlb_investments as { investors?: { investor_no?: string | null } } | null;
      return {
        id: row.id,
        investor_no: inv?.investors?.investor_no || null,
        type: row.type,
        period_no: row.period_no,
        due_date: dateOnly(row.due_date),
        paid_at: row.paid_at,
        gross_pesewas: Number(row.gross_pesewas),
        scholar_pesewas: Number(row.scholar_pesewas),
        net_pesewas: Number(row.net_pesewas),
        method: row.method,
        reference: row.reference,
      };
    });
  return {
    from,
    to,
    rows,
    totals: {
      gross_pesewas: rows.reduce((sum, row) => sum + row.gross_pesewas, 0),
      scholar_pesewas: rows.reduce((sum, row) => sum + row.scholar_pesewas, 0),
      net_pesewas: rows.reduce((sum, row) => sum + row.net_pesewas, 0),
      count: rows.length,
    },
  };
}

export function scholarFundCsv(report: Awaited<ReturnType<typeof scholarFundReport>>): string {
  const headers = ['group', 'key', 'scholar_pesewas', 'count'];
  const rows: unknown[][] = [
    ...report.by_month.map((row) => ['month', row.month, row.scholar_pesewas, row.count]),
    ...report.by_investor.map((row) => ['investor', row.investor_no || row.investor_id, row.scholar_pesewas, row.count]),
    ['total', 'all', report.totals.scholar_pesewas, report.totals.count],
  ];
  return csvTable(headers, rows);
}

export function payoutsCsv(report: Awaited<ReturnType<typeof payoutsReport>>): string {
  const headers = ['paid_at', 'due_date', 'investor_no', 'type', 'period_no', 'gross_pesewas', 'scholar_pesewas', 'net_pesewas', 'method', 'reference'];
  const rows = report.rows.map((row) => [
    row.paid_at,
    row.due_date,
    row.investor_no,
    row.type,
    row.period_no,
    row.gross_pesewas,
    row.scholar_pesewas,
    row.net_pesewas,
    row.method,
    row.reference,
  ]);
  rows.push(['', '', 'total', '', '', report.totals.gross_pesewas, report.totals.scholar_pesewas, report.totals.net_pesewas, '', '']);
  return csvTable(headers, rows);
}
