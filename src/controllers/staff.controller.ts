import { Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../utils/supabaseClient';
import { AuthRequest } from '../middleware/auth.middleware';
import { errorResponse, successResponse } from '../utils/responseHandlers';
import { logAudit } from '../services/audit.service';
import {
  invalidateSuperadminIdCache,
  isSuperadmin,
  staffRolesForViewer,
  userLookupStatus,
} from '../services/superadmin.service';

const MODULES = ['orders', 'products', 'content', 'devices', 'tickets', 'affiliates', 'vlb', 'finance'] as const;
const ROLES = ['staff', 'admin', 'superadmin'] as const;

const permissionSchema = z.object({
  module: z.enum(MODULES),
  can_view: z.boolean(),
  can_edit: z.boolean(),
}).transform((permission) => ({
  ...permission,
  can_view: permission.can_edit ? true : permission.can_view,
}));

const permissionsSchema = z.array(permissionSchema).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.module)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate module',
        path: [index, 'module'],
      });
    }
    seen.add(item.module);
  });
});

const createStaffSchema = z.object({
  email: z.string().trim().email(),
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  role: z.enum(ROLES),
  permissions: permissionsSchema,
});

const updateStaffSchema = z.object({
  role: z.enum(ROLES),
  permissions: permissionsSchema,
});

type StaffRole = (typeof ROLES)[number];
type StaffPermission = z.infer<typeof permissionSchema>;

function routeId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function allowedRoles(actorRole: string): StaffRole[] {
  if (actorRole === 'superadmin') return ['staff', 'admin', 'superadmin'];
  if (actorRole === 'admin') return ['staff'];
  return [];
}

function samePermissions(left: StaffPermission[], right: StaffPermission[]): boolean {
  const key = (items: StaffPermission[]) =>
    [...items]
      .sort((a, b) => a.module.localeCompare(b.module))
      .map((item) => `${item.module}:${item.can_view}:${item.can_edit}`)
      .join('|');
  return key(left) === key(right);
}

function inviteRedirect(): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'https://ventechgadgets.com').replace(/\/$/, '');
  return `${base}/reset-password`;
}

async function findAuthUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === normalized);
    if (found) return found;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function loadPermissions(userId: string): Promise<StaffPermission[]> {
  const { data, error } = await supabaseAdmin
    .from('staff_permissions')
    .select('module, can_view, can_edit')
    .eq('user_id', userId);
  if (error) throw error;
  return (data || []) as StaffPermission[];
}

async function replacePermissions(userId: string, permissions: StaffPermission[]) {
  const { error: deleteError } = await supabaseAdmin
    .from('staff_permissions')
    .delete()
    .eq('user_id', userId);
  if (deleteError) throw deleteError;

  if (permissions.length === 0) return;

  const { error: insertError } = await supabaseAdmin
    .from('staff_permissions')
    .insert(permissions.map((permission) => ({
      user_id: userId,
      module: permission.module,
      can_view: permission.can_view,
      can_edit: permission.can_edit,
    })));
  if (insertError) throw insertError;
}

async function superadminCount(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'superadmin');
  if (error) throw error;
  return count || 0;
}

async function ensureProfile(input: {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: StaffRole;
}) {
  const fullName = `${input.first_name} ${input.last_name}`.trim();
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', input.id)
    .maybeSingle();
  if (fetchError) throw fetchError;

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({
        email: input.email,
        first_name: input.first_name,
        last_name: input.last_name,
        full_name: fullName,
        role: input.role,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw error;
    return { before: existing, after: data };
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .insert({
      id: input.id,
      email: input.email,
      first_name: input.first_name,
      last_name: input.last_name,
      full_name: fullName,
      role: input.role,
    })
    .select('*')
    .single();
  if (error) throw error;
  return { before: null, after: data };
}

export const listStaff = async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, last_name, full_name, role, created_at')
      .in('role', staffRolesForViewer(req.user))
      .order('created_at', { ascending: false });

    if (error) throw error;
    const users = data || [];
    const ids = users.map((user) => user.id);
    const { data: permissions, error: permissionsError } = ids.length
      ? await supabaseAdmin
          .from('staff_permissions')
          .select('user_id, module, can_view, can_edit')
          .in('user_id', ids)
      : { data: [], error: null };
    if (permissionsError) throw permissionsError;

    const withPermissions = users.map((user) => ({
      ...user,
      staff_permissions: (permissions || []).filter((permission) => permission.user_id === user.id),
    }));
    return successResponse(res, withPermissions, 'Staff loaded');
  } catch (error) {
    console.error('Error listing staff:', error instanceof Error ? error.message : error);
    return errorResponse(res, 'Failed to load staff', 500);
  }
};

export const getStaff = async (req: AuthRequest, res: Response) => {
  try {
    const id = routeId(req.params.id);
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, last_name, full_name, role, created_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (userLookupStatus(data, req.user) === 'not_found') {
      return errorResponse(res, 'Staff member not found', 404);
    }
    if (!data || !['staff', 'admin', 'superadmin'].includes(data.role)) {
      return errorResponse(res, 'Staff member not found', 404);
    }
    const permissions = await loadPermissions(id);
    return successResponse(res, { ...data, staff_permissions: permissions }, 'Staff loaded');
  } catch (error) {
    console.error('Error loading staff member:', error instanceof Error ? error.message : error);
    return errorResponse(res, 'Failed to load staff member', 500);
  }
};

export const createStaff = async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return errorResponse(res, 'Invalid staff details', 400, parsed.error.flatten());
    }

    const email = parsed.data.email.toLowerCase();
    const { data: existingProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (profileError) throw profileError;

    if (!isSuperadmin(req.user) && existingProfile?.role === 'superadmin') {
      return successResponse(res, { email }, 'Staff member saved', 201);
    }

    const actorRole = req.user?.role || '';
    if (!allowedRoles(actorRole).includes(parsed.data.role)) {
      return errorResponse(res, 'Invalid staff details', 400);
    }

    let authUserId = existingProfile?.id as string | undefined;
    if (!authUserId) {
      const existingAuth = await findAuthUserByEmail(email);
      if (existingAuth) {
        authUserId = existingAuth.id;
      } else {
        const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          redirectTo: inviteRedirect(),
          data: {
            first_name: parsed.data.first_name,
            last_name: parsed.data.last_name,
          },
        });
        if (inviteError || !invited?.user) {
          const already = inviteError?.message?.toLowerCase().includes('already');
          if (!already) {
            return errorResponse(res, 'Could not invite this person.', 400);
          }
          const found = await findAuthUserByEmail(email);
          if (!found) {
            return errorResponse(res, 'A user with this email exists but could not be loaded', 409);
          }
          authUserId = found.id;
        } else {
          authUserId = invited.user.id;
        }
      }
    }

    const { before, after } = await ensureProfile({
      id: authUserId,
      email,
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      role: parsed.data.role,
    });
    const permissionsBefore = await loadPermissions(authUserId);
    await replacePermissions(authUserId, parsed.data.permissions);

    await logAudit({
      req,
      entity: 'users',
      entityId: authUserId,
      action: 'create_staff',
      before: before ? { ...before, permissions: permissionsBefore } : null,
      after: { ...after, permissions: parsed.data.permissions },
    });

    if (parsed.data.role === 'superadmin' || before?.role === 'superadmin') {
      invalidateSuperadminIdCache();
    }

    return successResponse(res, { ...after, permissions: parsed.data.permissions }, 'Staff member saved', 201);
  } catch (error) {
    console.error('Error creating staff:', error instanceof Error ? error.message : error);
    return errorResponse(res, 'Failed to create staff member', 500);
  }
};

export const updateStaff = async (req: AuthRequest, res: Response) => {
  try {
    const id = routeId(req.params.id);
    const parsed = updateStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return errorResponse(res, 'Invalid staff details', 400, parsed.error.flatten());
    }

    const actorRole = req.user?.role || '';
    if (!allowedRoles(actorRole).includes(parsed.data.role)) {
      return errorResponse(res, 'Invalid staff details', 400);
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (userLookupStatus(existing, req.user) === 'not_found') {
      return errorResponse(res, 'Staff member not found', 404);
    }
    if (!existing || !['staff', 'admin', 'superadmin'].includes(existing.role)) {
      return errorResponse(res, 'Staff member not found', 404);
    }

    if (existing.role === 'superadmin' && parsed.data.role !== 'superadmin') {
      const count = await superadminCount();
      if (count <= 1) {
        return errorResponse(res, 'The last superadmin cannot be demoted', 400);
      }
    }

    const permissionsBefore = await loadPermissions(id);
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        role: parsed.data.role,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    await replacePermissions(id, parsed.data.permissions);

    if (existing.role !== parsed.data.role) {
      await logAudit({
        req,
        entity: 'users',
        entityId: id,
        action: 'update_role',
        before: { id, role: existing.role },
        after: { id, role: parsed.data.role },
      });
    }

    if (!samePermissions(permissionsBefore, parsed.data.permissions)) {
      await logAudit({
        req,
        entity: 'staff_permissions',
        entityId: id,
        action: 'replace_permissions',
        before: permissionsBefore,
        after: parsed.data.permissions,
      });
    }

    if (existing.role === 'superadmin' || parsed.data.role === 'superadmin') {
      invalidateSuperadminIdCache();
    }

    return successResponse(res, { ...updated, permissions: parsed.data.permissions }, 'Staff member updated');
  } catch (error) {
    console.error('Error updating staff:', error instanceof Error ? error.message : error);
    return errorResponse(res, 'Failed to update staff member', 500);
  }
};

export const demoteStaff = async (req: AuthRequest, res: Response) => {
  try {
    const id = routeId(req.params.id);
    if (req.user?.id === id) {
      return errorResponse(res, 'You cannot demote yourself', 400);
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (userLookupStatus(existing, req.user) === 'not_found') {
      return errorResponse(res, 'Staff member not found', 404);
    }
    if (!existing || !['staff', 'admin', 'superadmin'].includes(existing.role)) {
      return errorResponse(res, 'Staff member not found', 404);
    }

    if (existing.role === 'superadmin') {
      const count = await superadminCount();
      if (count <= 1) {
        return errorResponse(res, 'The last superadmin cannot be demoted', 400);
      }
    }

    const permissionsBefore = await loadPermissions(id);
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        role: 'customer',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    const { error: deleteError } = await supabaseAdmin
      .from('staff_permissions')
      .delete()
      .eq('user_id', id);
    if (deleteError) throw deleteError;

    await logAudit({
      req,
      entity: 'users',
      entityId: id,
      action: 'demote_staff',
      before: { ...existing, permissions: permissionsBefore },
      after: { ...updated, permissions: [] },
    });

    if (existing.role === 'superadmin') invalidateSuperadminIdCache();

    return successResponse(res, updated, 'Staff member demoted');
  } catch (error) {
    console.error('Error demoting staff:', error instanceof Error ? error.message : error);
    return errorResponse(res, 'Failed to demote staff member', 500);
  }
};
