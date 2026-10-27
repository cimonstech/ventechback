import { Request } from 'express';
import { AffiliateError } from '../services/affiliate.service';
import { affiliateSettings } from '../services/affiliateSettings.service';
import { ledgerBalance, requestWithdrawal } from '../services/affiliateWallet.service';
import { supabaseAdmin } from '../utils/supabaseClient';

const OPEN_WITHDRAWAL = ['requested', 'processing', 'approved'];

type AuditReq = Request & { user?: { id?: string; role?: string } };

type MonthEndRow = {
  id: string;
  user_id: string;
  affiliate_no: string | null;
  payout_method: string | null;
  momo_number: string | null;
  bank_account_number: string | null;
  payout_details_changed_at: string | null;
};

function hasPayout(row: MonthEndRow): boolean {
  if (row.payout_method === 'momo') return Boolean(row.momo_number);
  if (row.payout_method === 'bank') return Boolean(row.bank_account_number);
  return false;
}

function inHold(changedAt: string | null, holdHours: number): boolean {
  if (!changedAt || holdHours <= 0) return false;
  return new Date(changedAt).getTime() + holdHours * 60 * 60 * 1000 > Date.now();
}

function systemReq(userId: string): AuditReq {
  return { user: { id: userId, role: 'system' } } as AuditReq;
}

export async function runMonthEndWithdrawals(): Promise<Record<string, number>> {
  const settings = await affiliateSettings.get();
  const counts = { considered: 0, created: 0, skipped: 0, failed: 0 };

  const { data, error } = await supabaseAdmin
    .from('affiliates')
    .select('id, user_id, affiliate_no, payout_method, momo_number, bank_account_number, payout_details_changed_at')
    .eq('status', 'active')
    .eq('withdrawal_mode', 'month_end');
  if (error) {
    console.error('month-end affiliates', error);
    throw new Error('Could not load affiliates for month-end withdrawals.');
  }

  const rows = (data || []) as MonthEndRow[];
  counts.considered = rows.length;
  if (!rows.length) return counts;

  const ids = rows.map((row) => row.id);
  const { data: openRows, error: openError } = await supabaseAdmin
    .from('affiliate_withdrawals')
    .select('affiliate_id')
    .in('affiliate_id', ids)
    .in('status', OPEN_WITHDRAWAL);
  if (openError) {
    console.error('month-end open withdrawals', openError);
    throw new Error('Could not load open withdrawals.');
  }
  const open = new Set((openRows || []).map((row) => row.affiliate_id as string));

  for (const row of rows) {
    try {
      if (!hasPayout(row) || inHold(row.payout_details_changed_at, settings.payoutChangeHoldHours) || open.has(row.id)) {
        counts.skipped += 1;
        continue;
      }
      const available = await ledgerBalance(row.id);
      if (available < settings.withdrawalMinPesewas) {
        counts.skipped += 1;
        continue;
      }
      await requestWithdrawal(systemReq(row.user_id), row.user_id, available);
      counts.created += 1;
    } catch (jobError) {
      if (jobError instanceof AffiliateError && jobError.statusCode < 500) {
        console.error(`month-end skip ${row.affiliate_no || row.id}`, jobError.message);
        counts.skipped += 1;
        continue;
      }
      console.error(`month-end failed ${row.affiliate_no || row.id}`, jobError);
      counts.failed += 1;
    }
  }

  return counts;
}
