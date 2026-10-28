import { createHash } from 'crypto';
import { supabaseAdmin } from '../utils/supabaseClient';

export const PORTAL_EVENTS = [
  'scan',
  'claim_start',
  'claim_complete',
  'guide_open',
  'faq_open',
  'service_start',
] as const;

export type PortalEventName = (typeof PORTAL_EVENTS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function logDb(scope: string, error: unknown) {
  console.error(scope, error);
}

function portalSalt(): string | null {
  const salt = (process.env.PORTAL_EVENT_SALT || process.env.AFFILIATE_IP_SALT || '').trim();
  return salt || null;
}

function sessionHash(sessionId: string | null): string | null {
  const salt = portalSalt();
  if (!salt) return null;
  const id = (sessionId || '').trim().slice(0, 128);
  if (!id) return null;
  return createHash('sha256').update(`${id}${salt}`).digest('hex');
}

export async function recordPortalEvent(input: {
  event: string;
  token?: string | null;
  articleId?: string | null;
  sessionId?: string | null;
}): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!PORTAL_EVENTS.includes(input.event as PortalEventName)) {
    return { ok: false, status: 400, message: 'Unknown event.' };
  }

  let deviceId: string | null = null;
  const token = (input.token || '').trim();
  if (token) {
    const { data, error } = await supabaseAdmin
      .from('devices')
      .select('id')
      .eq('qr_token', token)
      .maybeSingle();
    if (error) {
      logDb('portal event device', error);
      return { ok: false, status: 500, message: 'Failed to record the event' };
    }
    deviceId = data?.id || null;
  }

  const articleId = (input.articleId || '').trim();
  const { error } = await supabaseAdmin.from('portal_events').insert({
    event: input.event,
    device_id: deviceId,
    article_id: UUID_RE.test(articleId) ? articleId : null,
    session_hash: sessionHash(input.sessionId || null),
  });
  if (error) {
    logDb('portal event insert', error);
    return { ok: false, status: 500, message: 'Failed to record the event' };
  }
  return { ok: true };
}

async function countsSince(sinceIso: string): Promise<Record<PortalEventName, number>> {
  const counts = Object.fromEntries(PORTAL_EVENTS.map((event) => [event, 0])) as Record<PortalEventName, number>;
  const { data, error } = await supabaseAdmin
    .from('portal_events')
    .select('event')
    .gte('created_at', sinceIso);
  if (error) {
    logDb('portal event counts', error);
    throw error;
  }
  for (const row of data || []) {
    const event = row.event as PortalEventName;
    if (event in counts) counts[event] += 1;
  }
  return counts;
}

function completionRate(counts: Record<PortalEventName, number>): number | null {
  if (!counts.claim_start) return null;
  return Math.round((counts.claim_complete / counts.claim_start) * 1000) / 10;
}

export async function portalEventStats(): Promise<{
  last_7_days: Record<PortalEventName, number> & { claim_completion_rate: number | null };
  last_30_days: Record<PortalEventName, number> & { claim_completion_rate: number | null };
}> {
  const now = Date.now();
  const [last7, last30] = await Promise.all([
    countsSince(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()),
    countsSince(new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()),
  ]);
  return {
    last_7_days: { ...last7, claim_completion_rate: completionRate(last7) },
    last_30_days: { ...last30, claim_completion_rate: completionRate(last30) },
  };
}
