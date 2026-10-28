import { adminNotificationEmail } from '../config/email';
import { siteOrigin } from '../services/affiliate.service';
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

function ghs(pesewas: number): string {
  return `GHS ${(Number(pesewas) / 100).toFixed(2)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function displayName(user: UserLite | null): string {
  if (!user) return 'there';
  return user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'there';
}

function formatAccraDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function investmentsUrl(id?: string): string | null {
  const origin = siteOrigin();
  if (!origin) return null;
  return id ? `${origin}/account/investments/${id}` : `${origin}/account/investments`;
}

function wrapHtml(title: string, body: string): string {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1A1A1A;max-width:640px;margin:0 auto;">
      <h1 style="color:#FF7A19;font-size:22px;">${escapeHtml(title)}</h1>
      ${body}
      <p style="color:#666;font-size:12px;margin-top:32px;">VENTECH Gadgets</p>
    </div>
  `;
}

async function send(to: string, subject: string, html: string): Promise<boolean> {
  const sent = await emailService.sendEmail({ to, subject, html }, true);
  if (!sent) console.error(`[jobs] vlb email failed subject=${subject} to=${to}`);
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
  const amount = ghs(payout.net_pesewas);
  const link = investmentsUrl(investment?.id);
  const body = `
    <p>Hi ${escapeHtml(displayName(user))},</p>
    <p>Your payout of ${escapeHtml(amount)} is due today.</p>
    <p>We will process it to your saved payout details.</p>
    ${link ? `<p><a href="${escapeHtml(link)}" style="color:#FF7A19;">View your investments</a></p>` : ''}
  `;
  const sent = await send(email, `Your payout of ${amount} is due today`, wrapHtml('Payout due today', body));
  if (!sent) throw new Error('Could not email this investor.');
}

async function emailSettlementInvestor(
  investment: InvestmentLite,
  investor: (InvestorLite & { user: UserLite | null }) | undefined
): Promise<void> {
  const user = investor?.user || null;
  const email = user?.email;
  if (!email) return;
  const link = investmentsUrl(investment.id);
  const body = `
    <p>Hi ${escapeHtml(displayName(user))},</p>
    <p>Your Laptop Banking investment of ${escapeHtml(ghs(investment.principal_pesewas))} has entered its settlement month.</p>
    <p>Choose to settle or renew in your account. If you do not choose, your principal will be paid out.</p>
    ${link ? `<p><a href="${escapeHtml(link)}" style="color:#FF7A19;">Choose settle or renew</a></p>` : ''}
  `;
  const sent = await send(
    email,
    'Your Laptop Banking investment is in settlement',
    wrapHtml('Settlement month', body)
  );
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
  const deadline = formatAccraDate(chooseBy);
  const link = investmentsUrl(investment.id);
  const body = `
    <p>Hi ${escapeHtml(displayName(user))},</p>
    <p>Choose to settle or renew by ${escapeHtml(deadline)}; if you don't choose, your principal will be paid out.</p>
    ${link ? `<p><a href="${escapeHtml(link)}" style="color:#FF7A19;">Choose settle or renew</a></p>` : ''}
  `;
  const sent = await send(
    email,
    `Choose to settle or renew by ${deadline}`,
    wrapHtml('Choose settle or renew', body)
  );
  if (!sent) throw new Error('Could not email this investor.');
}

function payoutAdminHtml(today: string, rows: Array<{
  investorNo: string;
  name: string;
  type: string;
  dueDate: string;
  amount: number;
}>): string {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const items = rows
    .map((row) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(row.investorNo)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(row.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(row.type)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(row.dueDate)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${escapeHtml(ghs(row.amount))}</td>
      </tr>`)
    .join('');
  return wrapHtml(
    'Laptop Banking payouts due today',
    `
      <p>${rows.length} payout${rows.length === 1 ? '' : 's'} due on ${escapeHtml(today)}. Total net: <strong>${escapeHtml(ghs(total))}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #FF7A19;">Investor</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #FF7A19;">Name</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #FF7A19;">Type</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #FF7A19;">Due</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #FF7A19;">Net</th>
          </tr>
        </thead>
        <tbody>${items}</tbody>
      </table>
    `
  );
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
    const total = adminRows.reduce((sum, row) => sum + row.amount, 0);
    const adminResult = await once('vlb-payouts-due-admin', today, async () => {
      const sent = await send(
        adminNotificationEmail,
        `Laptop Banking: ${dueToday.length} payout${dueToday.length === 1 ? '' : 's'} due today (${ghs(total)})`,
        payoutAdminHtml(today, adminRows)
      );
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
    const items = rows
      .map((investment) => {
        const investor = investors.get(investment.investor_id);
        return `<li>${escapeHtml(investor?.investor_no || investment.id)} — ${escapeHtml(displayName(investor?.user || null))} — ${escapeHtml(ghs(investment.principal_pesewas))}</li>`;
      })
      .join('');
    const adminResult = await once('vlb-settlement-admin', today, async () => {
      const sent = await send(
        adminNotificationEmail,
        `Laptop Banking: ${rows.length} investment${rows.length === 1 ? '' : 's'} entered settlement`,
        wrapHtml(
          'Laptop Banking settlement',
          `<p>These investments entered the settlement month today:</p><ul>${items}</ul>`
        )
      );
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
