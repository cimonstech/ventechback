export const TEAM_ACTOR_NAME = 'VENTECH Team';

export type RoleUser = { id?: string | null; role?: string | null } | null | undefined;

export function isSuperadmin(user: RoleUser): boolean {
  return (user?.role || '') === 'superadmin';
}

export function staffRolesForViewer(viewer: RoleUser): Array<'staff' | 'admin' | 'superadmin'> {
  return isSuperadmin(viewer) ? ['staff', 'admin', 'superadmin'] : ['staff', 'admin'];
}

export function isHiddenSuperadmin(
  viewer: RoleUser,
  target: RoleUser,
  superadminIds: ReadonlySet<string> = new Set()
): boolean {
  if (isSuperadmin(viewer) || !target) return false;
  if (target.role === 'superadmin') return true;
  if (target.id && superadminIds.has(target.id)) return true;
  return false;
}

export function visibleStaff<T extends { role?: string | null }>(
  users: T[],
  viewer: RoleUser
): T[] {
  if (isSuperadmin(viewer)) return users;
  return users.filter((user) => user.role !== 'superadmin');
}

export function staffCountForViewer<T extends { role?: string | null }>(
  users: T[],
  viewer: RoleUser
): number {
  return visibleStaff(users, viewer).length;
}

export function userLookupStatus(
  target: { id?: string | null; role?: string | null } | null,
  viewer: RoleUser
): 'ok' | 'not_found' {
  if (!target) return 'not_found';
  if (isHiddenSuperadmin(viewer, target)) return 'not_found';
  return 'ok';
}

function jsonRole(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const role = (value as Record<string, unknown>).role;
  return typeof role === 'string' ? role : null;
}

export interface AuditRowLike {
  actor_id?: string | null;
  actor_role?: string | null;
  entity_id?: string | null;
  action?: string | null;
  before?: unknown;
  after?: unknown;
}

export function auditRowVisibleToViewer(
  row: AuditRowLike,
  viewer: RoleUser,
  superadminIds: ReadonlySet<string>
): boolean {
  if (isSuperadmin(viewer)) return true;
  if (row.actor_role === 'superadmin') return false;
  if (row.actor_id && superadminIds.has(row.actor_id)) return false;
  if (row.entity_id && superadminIds.has(row.entity_id)) return false;
  if (jsonRole(row.before) === 'superadmin') return false;
  if (jsonRole(row.after) === 'superadmin') return false;
  if (typeof row.action === 'string' && row.action.toLowerCase().includes('superadmin')) return false;
  return true;
}

export function presentStaffFacingActor(
  viewer: RoleUser,
  actor: { id?: string | null; role?: string | null; name?: string | null } | null | undefined,
  superadminIds: ReadonlySet<string>
): { id: string | null; role: string | null; name: string } {
  if (isHiddenSuperadmin(viewer, actor, superadminIds)) {
    return { id: null, role: null, name: TEAM_ACTOR_NAME };
  }
  return {
    id: actor?.id ?? null,
    role: actor?.role ?? null,
    name: (actor?.name || '').trim() || 'Staff',
  };
}

export function presentCustomerActorRole(actorRole: string | null | undefined): string | null {
  return actorRole === 'customer' ? 'customer' : null;
}

export function presentAssigneeForViewer(
  viewer: RoleUser,
  assignee: { id?: string | null; role?: string | null; name?: string | null; email?: string | null } | null,
  superadminIds: ReadonlySet<string>
): {
  id: string | null;
  name: string | null;
  email: string | null;
  locked: boolean;
} {
  if (!assignee?.id) {
    return { id: null, name: null, email: null, locked: false };
  }
  if (isHiddenSuperadmin(viewer, assignee, superadminIds)) {
    return { id: null, name: TEAM_ACTOR_NAME, email: null, locked: true };
  }
  return {
    id: assignee.id,
    name: assignee.name || null,
    email: assignee.email ?? null,
    locked: false,
  };
}

export function rewriteAssignedBody(
  body: string | null | undefined,
  superadminNames: readonly string[],
  viewer: RoleUser
): string | null {
  if (!body) return body ?? null;
  if (isSuperadmin(viewer) || superadminNames.length === 0) return body;
  let next = body;
  for (const name of superadminNames) {
    if (name && next.includes(name)) next = next.split(name).join(TEAM_ACTOR_NAME);
  }
  return next;
}
