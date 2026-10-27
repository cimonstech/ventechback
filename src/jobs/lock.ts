import { supabaseAdmin } from '../utils/supabaseClient';

export interface ClaimResult {
  claimed: boolean;
  id?: string;
}

function logDb(scope: string, error: unknown) {
  console.error(scope, error);
}

export async function claimJobRun(jobName: string, periodKey: string): Promise<ClaimResult> {
  const { data, error } = await supabaseAdmin.rpc('claim_job_run', {
    p_job_name: jobName,
    p_period_key: periodKey,
    p_stale_seconds: 1800,
  });
  if (error) {
    logDb('claim job run', error);
    throw new Error('Could not claim this job.');
  }
  const row = (data || {}) as { claimed?: boolean; id?: string };
  return {
    claimed: row.claimed === true,
    id: typeof row.id === 'string' ? row.id : undefined,
  };
}

export async function finishJobRun(
  id: string | undefined,
  status: 'succeeded' | 'failed',
  counts?: Record<string, number> | null,
  errorMessage?: string
): Promise<void> {
  if (!id) return;
  const { error } = await supabaseAdmin.rpc('finish_job_run', {
    p_id: id,
    p_status: status,
    p_counts: counts || null,
    p_error: errorMessage ? errorMessage.slice(0, 500) : null,
  });
  if (error) logDb('finish job run', error);
}

export function accraDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function accraMonthKey(date = new Date()): string {
  return accraDateKey(date).slice(0, 7);
}
