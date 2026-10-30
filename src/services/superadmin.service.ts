import { supabaseAdmin } from '../utils/supabaseClient';
import {
  TEAM_ACTOR_NAME,
  isSuperadmin,
  type RoleUser,
} from './superadmin.visibility';

export {
  TEAM_ACTOR_NAME,
  auditRowVisibleToViewer,
  isHiddenSuperadmin,
  isSuperadmin,
  presentAssigneeForViewer,
  presentCustomerActorRole,
  presentStaffFacingActor,
  rewriteAssignedBody,
  staffCountForViewer,
  staffRolesForViewer,
  userLookupStatus,
  visibleStaff,
} from './superadmin.visibility';

const CACHE_MS = 60_000;

let cachedIds: { ids: string[]; at: number } | null = null;

export function invalidateSuperadminIdCache(): void {
  cachedIds = null;
}

export async function getSuperadminIds(): Promise<string[]> {
  if (cachedIds && Date.now() - cachedIds.at < CACHE_MS) {
    return cachedIds.ids;
  }
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('role', 'superadmin');
  if (error) throw error;
  cachedIds = {
    ids: (data || []).map((row) => row.id),
    at: Date.now(),
  };
  return cachedIds.ids;
}

export async function getSuperadminIdSet(): Promise<Set<string>> {
  return new Set(await getSuperadminIds());
}

export async function loadSuperadminNames(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('full_name, first_name, last_name, email')
    .eq('role', 'superadmin');
  if (error) throw error;
  return (data || [])
    .flatMap((row) => {
      const full = (row.full_name || '').trim();
      const combined = [row.first_name, row.last_name].map((part) => (part || '').trim()).filter(Boolean).join(' ');
      return [full, combined, (row.email || '').trim()].filter(Boolean);
    });
}

export async function maskStaffUserId(viewer: RoleUser, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  if (isSuperadmin(viewer)) return userId;
  const ids = await getSuperadminIdSet();
  return ids.has(userId) ? null : userId;
}

export async function maskStaffUserIds<T extends Record<string, unknown>>(
  viewer: RoleUser,
  rows: T[],
  keys: string[]
): Promise<T[]> {
  if (isSuperadmin(viewer) || rows.length === 0) return rows;
  const ids = await getSuperadminIdSet();
  return rows.map((row) => {
    const next = { ...row };
    for (const key of keys) {
      const value = next[key];
      if (typeof value === 'string' && ids.has(value)) (next as Record<string, unknown>)[key] = null;
    }
    return next;
  });
}

type FilterableQuery = {
  or: (filters: string) => FilterableQuery;
};

export function applyHiddenSuperadminAuditFilter<T extends FilterableQuery>(query: T, superadminIds: string[]): T {
  let next: FilterableQuery = query.or('actor_role.is.null,actor_role.neq.superadmin');
  next = next.or('before.is.null,before->>role.is.null,before->>role.neq.superadmin');
  next = next.or('after.is.null,after->>role.is.null,after->>role.neq.superadmin');
  if (superadminIds.length > 0) {
    const list = `(${superadminIds.join(',')})`;
    next = next.or(`actor_id.is.null,actor_id.not.in.${list}`);
    next = next.or(`entity_id.is.null,entity_id.not.in.${list}`);
  }
  return next as T;
}

export async function loadOrderTimeline(
  orderId: string,
  viewer: RoleUser
): Promise<Array<{
  id: string;
  created_at: string;
  action: string;
  actor_id: string | null;
  actor_role: string | null;
  actor_name: string;
}>> {
  const { data, error } = await supabaseAdmin
    .from('audit_log')
    .select('id, actor_id, actor_role, action, created_at')
    .eq('entity', 'orders')
    .eq('entity_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const ids = await getSuperadminIdSet();
  return (data || []).map((row) => {
    const hidden = !isSuperadmin(viewer) && (
      row.actor_role === 'superadmin' || (!!row.actor_id && ids.has(row.actor_id))
    );
    return {
      id: row.id,
      created_at: row.created_at,
      action: row.action,
      actor_id: hidden ? null : row.actor_id,
      actor_role: hidden ? null : row.actor_role,
      actor_name: hidden ? TEAM_ACTOR_NAME : (row.actor_role || 'Staff'),
    };
  });
}
