import { adminNotificationEmail } from '../config/email';
import {
  vlbAdminPayoutsDue,
  vlbAdminSettlement,
  vlbPayoutDue,
  vlbRenewalNudge,
  vlbSettlement,
  type RenderedEmail,
} from '../emails';
import { emailService } from '../services/email.service';
import { markDuePayouts, moveToSettlement } from '../services/vlb.service';
import {
  addDays,
  renewalNudgeDue,
  snapshotFromPlan,
  termProgress,
  todayAccra,
} from '../services/vlbCalc.service';
import { supabaseAdmin } from '../utils/supabaseClient';
import { claimJobRun, finishJobRun } from './lock';

type UserLite = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
};

type InvestorLite = {
  id: string;
  user_id: string;
  investor_no: string | null;
};

type PayoutLite = {
  id: string;
  investment_id: string;
  type: string;
  due_date: string;
  net_pesewas: number;
  status: string;
};

type InvestmentLite = {
  id: string;
  investor_id: string;
  start_date: string;
  principal_pesewas: number;
  plan_snapshot: Record<string, unknown> | null;
  status: string;
  renewal_chosen_at: string | null;
};

function logDb(scope: string, error: unknown) {
  console.error(`[jobs] vlb ${scope}`, error);
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 500);
  return 'Job failed.';
}

function displayName(user: UserLite | null): string {
  if (!user) return 'there';
  return user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'there';
}

async function send(to: string, rendered: RenderedEmail): Promise<boolean> {
  const sent = await emailService.sendEmail(
    {
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      rendered,
    },
    true
  );
  if (!sent) console.error(`[jobs] vlb email failed subject=${rendered.subject} to=${to}`);
  return sent;
}

async function once(
  jobName: string,
  periodKey: string,
  work: () => Promise<void>
): Promise<'sent' | 'skipped' | 'failed'> {
  let runId: string | undefined;
  try {
    const claim = await claimJobRun(jobName, periodKey);
    if (!claim.claimed) return 'skipped';
    runId = claim.id;
    await work();
    await finishJobRun(runId, 'succeeded', { emailed: 1 });
    return 'sent';
  } catch (error) {
    console.error(`[jobs] vlb ${jobName} ${periodKey}`, error);
    try {
      await finishJobRun(runId, 'failed', null, errorText(error));
    } catch (finishError) {
      console.error(`[jobs] vlb finish ${jobName}`, finishError);
    }
    return 'failed';
  }
}

async function loadPayoutsDue(today: string): Promise<PayoutLite[]> {
  const { data, error } = await supabaseAdmin
    .from('vlb_payouts')
    .select('id, investment_id, type, due_date, net_pesewas, status')
    .eq('status', 'due')
    .gte('due_date', addDays(today, -7))
    .lte('due_date', today);
  if (error) {
    logDb('load due payouts', error);
    throw new Error('Could not load due payouts.');
  }
  return (data || []) as PayoutLite[];
}

async function loadInvestments(ids: string[]): Promise<InvestmentLite[]> {
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin
    .from('vlb_investments')
    .select('id, investor_id, start_date, principal_pesewas, plan_snapshot, status, renewal_chosen_at')
    .in('id', ids);
  if (error) {
    logDb('load investments', error);
    throw new Error('Could not load investments.');
  }
  return (data || []) as InvestmentLite[];
}

async function loadOpenInvestments(): Promise<InvestmentLite[]> {
  const { data, error } = await supabaseAdmin
    .from('vlb_investments')
    .select('id, investor_id, start_date, principal_pesewas, plan_snapshot, status, renewal_chosen_at')
    .in('status', ['active', 'settlement'])
    .is('renewal_chosen_at', null);
  if (error) {
    logDb('load open investments', error);
    throw new Error('Could not load investments.');
  }
  return (data || []) as InvestmentLite[];
}

async function loadInvestorMap(investorIds: string[]): Promise<Map<string, InvestorLite & { user: UserLite | null }>> {
  const map = new Map<string, InvestorLite & { user: UserLite | null }>();
  const unique = [...new Set(investorIds.filter(Boolean))];
  if (!unique.length) return map;

  const { data: investors, error: investorError } = await supabaseAdmin
    .from('investors')
    .select('id, user_id, investor_no')
    .in('id', unique);
  if (investorError) {
    logDb('load investors', investorError);
    throw new Error('Could not load investors.');
  }

  const rows = (investors || []) as InvestorLite[];
  const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
  const users = new Map<string, UserLite>();
  if (userIds.length) {
    const { data: userRows, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .in('id', userIds);
    if (userError) {
      logDb('load users', userError);
      throw new Error('Could not load investors.');
    }
    for (const user of (userRows || []) as UserLite[]) users.set(user.id, user);
  }

  for (const row of rows) {
    map.set(row.id, { ...row, user: users.get(row.user_id) || null });
  }
  return map;
}

async function emailPayoutDue(
  payout: PayoutLite,
  investment: InvestmentLite | undefined,
  investor: (InvestorLite & { user: UserLite | null }) | undefined
): Promise<void> {
  const user = investor?.user || null;
  const email = user?.email;
  if (!email) return;
  const rendered = vlbPayoutDue({
    firstName: displayName(user),
    amountPesewas: payout.net_pesewas,
    investmentId: investment?.id,
  });
  const sent = await send(email, rendered);
  if (!sent) throw new Error('Could not email this investor.');
}

async function emailSettlementInvestor(
  investment: InvestmentLite,
  investor: (InvestorLite & { user: UserLite | null }) | undefined
): Promise<void> {
  const user = investor?.user || null;
  const email = user?.email;
  if (!email) return;
  const rendered = vlbSettlement({
    firstName: displayName(user),
    principalPesewas: investment.principal_pesewas,
    investmentId: investment.id,
  });
  const sent = await send(email, rendered);
  if (!sent) throw new Error('Could not email this investor.');
}

async function emailRenewalNudge(
  investment: InvestmentLite,
  investor: (InvestorLite & { user: UserLite | null }) | undefined,
  chooseBy: string
): Promise<void> {
  const user = investor?.user || null;
  const email = user?.email;
  if (!email) return;
  const rendered = vlbRenewalNudge({
    firstName: displayName(user),
    chooseBy,
    investmentId: investment.id,
  });
  const sent = await send(email, rendered);
  if (!sent) throw new Error('Could not email this investor.');
}

function payoutAdminEmail(today: string, rows: Array<{
  investorNo: string;
  name: string;
  type: string;
  dueDate: string;
  amount: number;
}>) {
  return vlbAdminPayoutsDue({
    today,
    rows: rows.map((row) => ({
      investorNo: row.investorNo,
      name: row.name,
      type: row.type,
      dueDate: row.dueDate,
      amountPesewas: row.amount,
    })),
  });
}

export async function runVlbPayoutsDue(): Promise<Record<string, number>> {
  const today = todayAccra();
  const marked = await markDuePayouts(today);
  const payouts = await loadPayoutsDue(today);
  const investments = await loadInvestments([...new Set(payouts.map((row) => row.investment_id))]);
  const investmentById = new Map(investments.map((row) => [row.id, row]));
  const investors = await loadInvestorMap(investments.map((row) => row.investor_id));

  const counts = { marked, due: payouts.length, emailed: 0, skipped: 0, failed: 0, admin_emailed: 0 };

  for (const payout of payouts) {
    const investment = investmentById.get(payout.investment_id);
    const investor = investment ? investors.get(investment.investor_id) : undefined;
    const result = await once('vlb-payout-due-email', payout.id, () =>
      emailPayoutDue(payout, investment, investor)
    );
    if (result === 'sent') counts.emailed += 1;
    else if (result === 'skipped') counts.skipped += 1;
    else counts.failed += 1;
  }

  const dueToday = payouts.filter((row) => row.due_date === today);
  if (dueToday.length) {
    const adminRows = dueToday.map((payout) => {
      const investment = investmentById.get(payout.investment_id);
      const investor = investment ? investors.get(investment.investor_id) : undefined;
      return {
        investorNo: investor?.investor_no || investment?.id || payout.investment_id,
        name: displayName(investor?.user || null),
        type: payout.type,
        dueDate: payout.due_date,
        amount: payout.net_pesewas,
      };
    });
    const adminResult = await once('vlb-payouts-due-admin', today, async () => {
      const rendered = payoutAdminEmail(today, adminRows);
      const sent = await send(adminNotificationEmail, rendered);
      if (!sent) throw new Error('Could not email the admin summary.');
    });
    if (adminResult === 'sent') counts.admin_emailed = 1;
    else if (adminResult === 'failed') counts.failed += 1;
  }

  return counts;
}

export async function runVlbSettlement(): Promise<Record<string, number>> {
  const today = todayAccra();
  const moved = await moveToSettlement(today);
  const todayStart = `${today}T00:00:00.000Z`;
  const { data, error } = await supabaseAdmin
    .from('vlb_investments')
    .select('id, investor_id, start_date, principal_pesewas, plan_snapshot, status, renewal_chosen_at')
    .eq('status', 'settlement')
    .gte('updated_at', todayStart);
  if (error) {
    logDb('load settlement', error);
    throw new Error('Could not load investments in settlement.');
  }
  const rows = (data || []) as InvestmentLite[];
  const investors = await loadInvestorMap(rows.map((row) => row.investor_id));
  const counts = { moved, entered: rows.length, emailed: 0, skipped: 0, failed: 0, admin_emailed: 0 };

  for (const investment of rows) {
    const investor = investors.get(investment.investor_id);
    const result = await once('vlb-settlement-email', investment.id, () =>
      emailSettlementInvestor(investment, investor)
    );
    if (result === 'sent') counts.emailed += 1;
    else if (result === 'skipped') counts.skipped += 1;
    else counts.failed += 1;
  }

  if (rows.length) {
    const adminResult = await once('vlb-settlement-admin', today, async () => {
      const rendered = vlbAdminSettlement({
        rows: rows.map((investment) => {
          const investor = investors.get(investment.investor_id);
          return {
            investorNo: investor?.investor_no || investment.id,
            name: displayName(investor?.user || null),
            principalPesewas: investment.principal_pesewas,
          };
        }),
      });
      const sent = await send(adminNotificationEmail, rendered);
      if (!sent) throw new Error('Could not email the admin summary.');
    });
    if (adminResult === 'sent') counts.admin_emailed = 1;
    else if (adminResult === 'failed') counts.failed += 1;
  }

  return counts;
}

export async function runVlbRenewalNudge(): Promise<Record<string, number>> {
  const today = todayAccra();
  const investments = await loadOpenInvestments();
  const counts = { considered: investments.length, due: 0, emailed: 0, skipped: 0, failed: 0 };
  const targets: Array<{ investment: InvestmentLite; chooseBy: string }> = [];

  for (const investment of investments) {
    try {
      const start = String(investment.start_date || '').slice(0, 10);
      const snapshot = snapshotFromPlan(
        investment.plan_snapshot as Parameters<typeof snapshotFromPlan>[0]
      );
      const progress = termProgress(snapshot, start, today);
      if (!renewalNudgeDue(today, progress.last_term_final_month_start)) continue;
      targets.push({
        investment,
        chooseBy: addDays(progress.settlement_month_start, -1),
      });
    } catch (error) {
      console.error(`[jobs] vlb renewal window ${investment.id}`, error);
      counts.failed += 1;
    }
  }

  counts.due = targets.length;
  const investors = await loadInvestorMap(targets.map((row) => row.investment.investor_id));

  for (const row of targets) {
    const investor = investors.get(row.investment.investor_id);
    const result = await once('vlb-renewal-nudge-email', row.investment.id, () =>
      emailRenewalNudge(row.investment, investor, row.chooseBy)
    );
    if (result === 'sent') counts.emailed += 1;
    else if (result === 'skipped') counts.skipped += 1;
    else counts.failed += 1;
  }

  return counts;
}
