import { Response } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { AuthRequest, PERMISSION_MODULES } from '../middleware/auth.middleware';
import { errorResponse, successResponse } from '../utils/responseHandlers';

export const getMyAccess = async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role || 'customer';
    const userId = req.user?.id;

    let permissions: { module: string; can_view: boolean; can_edit: boolean }[] = [];
    if (role === 'admin' || role === 'superadmin') {
      permissions = PERMISSION_MODULES.map((module) => ({
        module,
        can_view: true,
        can_edit: true,
      }));
    } else if (role === 'staff' && userId) {
      const { data, error } = await supabaseAdmin
        .from('staff_permissions')
        .select('module, can_view, can_edit')
        .eq('user_id', userId);
      if (error) throw error;
      permissions = data || [];
    }

    const { data: programRoles, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('role, status')
      .eq('user_id', userId);

    if (rolesError) throw rolesError;

    return successResponse(res, {
      role,
      permissions,
      programRoles: programRoles || [],
    });
  } catch (error) {
    console.error('Error loading access:', error instanceof Error ? error.message : error);
    return errorResponse(res, 'Failed to load access', 500);
  }
};
