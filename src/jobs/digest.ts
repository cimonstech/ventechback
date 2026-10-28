import { adminNotificationEmail } from '../config/email';
import { emailService } from '../services/email.service';
import { addDays, todayAccra } from '../services/vlbCalc.service';
import { supabaseAdmin } from '../utils/supabaseClient';

const OPEN_TICKETS = ['submitted', 'under_review', 'diagnosing', 'repair_resolution', 'ready'];
const OPEN_WITHDRAWAL = ['requested', 'processing', 'approved'];

async function countOrZero(
  scope: string,
  query: PromiseLike<{ count: number | null; error: unknown }>
): Promise<number> {
  const { count, error } = await query;
  if (error) {
    console.error(scope, error);
    throw new Error('Could not load the admin summary.');
  }
  return count || 0;
}

export async function sendAdminDigest(): Promise<Record<string, number>> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const today = todayAccra();
  const weekEnd = addDays(today, 6);

  const [
    commissionsReady,
    openWithdrawals,
    applicationsPending,
    staleServiceRequests,
    vlbPayoutsDueWeek,
    vlbInSettlement,
    vlbNewApplications,
  ] = await Promise.all([
    countOrZero(
      'digest commissions ready',
      supabaseAdmin
        .from('affiliate_commissions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lte('eligible_from', now)
    ),
    countOrZero(
      'digest open withdrawals',
      supabaseAdmin
        .from('affiliate_withdrawals')
        .select('id', { count: 'exact', head: true })
        .in('status', OPEN_WITHDRAWAL)
    ),
    countOrZero(
      'digest applications pending',
      supabaseAdmin.from('affiliates').select('id', { count: 'exact', head: true }).eq('status', 'pending')
    ),
    countOrZero(
      'digest stale tickets',
      supabaseAdmin
        .from('service_tickets')
        .select('id', { count: 'exact', head: true })
        .in('status', OPEN_TICKETS)
        .lt('created_at', weekAgo)
    ),
    countOrZero(
      'digest vlb payouts due week',
      supabaseAdmin
        .from('vlb_payouts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'due')
        .lte('due_date', weekEnd)
    ),
    countOrZero(
      'digest vlb settlement',
      supabaseAdmin.from('vlb_investments').select('id', { count: 'exact', head: true }).eq('status', 'settlement')
    ),
    countOrZero(
      'digest vlb applications new',
      supabaseAdmin.from('vlb_applications').select('id', { count: 'exact', head: true }).eq('status', 'new')
    ),
  ]);

  const counts = {
    commissions_ready: commissionsReady,
    open_withdrawals: openWithdrawals,
    applications_pending: applicationsPending,
    stale_service_requests: staleServiceRequests,
    vlb_payouts_due_week: vlbPayoutsDueWeek,
    vlb_in_settlement: vlbInSettlement,
    vlb_new_applications: vlbNewApplications,
  };

  if (Object.values(counts).every((value) => value === 0)) {
    return { ...counts, emailed: 0 };
  }

  const sent = await emailService.sendEmail(
    {
      to: adminNotificationEmail,
      subject: 'Daily operations summary',
      html: `
        <p>Items that need attention:</p>
        <ul>
          <li>Commissions ready to verify: ${commissionsReady}</li>
          <li>Open withdrawals: ${openWithdrawals}</li>
          <li>Applications pending: ${applicationsPending}</li>
          <li>Service requests older than 7 days: ${staleServiceRequests}</li>
          <li>Laptop Banking payouts due this week: ${vlbPayoutsDueWeek}</li>
          <li>Laptop Banking investments in settlement: ${vlbInSettlement}</li>
          <li>Laptop Banking new applications: ${vlbNewApplications}</li>
        </ul>
        <p>VENTECH Gadgets</p>
      `,
    },
    true
  );
  if (!sent) throw new Error('Could not send the admin summary.');

  return { ...counts, emailed: 1 };
}
