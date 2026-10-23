import { Request } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';

const SECRET_KEYS = new Set(['password', 'token', 'secret', 'authorization']);

type AuditRequest = Request & {
  user?: { id?: string; role?: string };
};

export interface AuditEntry {
  req: AuditRequest;
  entity: string;
  entityId?: string | string[] | null;
  action: string;
  before?: unknown;
  after?: unknown;
}

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripSecrets(item));
  }

  if (value && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key.toLowerCase())) {
        continue;
      }
      cleaned[key] = stripSecrets(child);
    }
    return cleaned;
  }

  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'unknown error';
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('audit_log').insert({
      actor_id: entry.req.user?.id ?? null,
      actor_role: entry.req.user?.role ?? null,
      entity: entry.entity,
      entity_id: Array.isArray(entry.entityId) ? entry.entityId[0] ?? null : entry.entityId ?? null,
      action: entry.action,
      before: entry.before === undefined ? null : stripSecrets(entry.before),
      after: entry.after === undefined ? null : stripSecrets(entry.after),
      ip_address: entry.req.ip ?? null,
    });

    if (error) {
      console.error('Audit log insert failed:', errorMessage(error));
    }
  } catch (error) {
    console.error('Audit log insert failed:', errorMessage(error));
  }
}
