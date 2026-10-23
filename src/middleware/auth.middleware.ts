import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { errorResponse } from '../utils/responseHandlers';

export type PermissionModule =
  | 'orders'
  | 'products'
  | 'content'
  | 'devices'
  | 'tickets'
  | 'affiliates'
  | 'vlb'
  | 'finance';

export type PermissionLevel = 'view' | 'edit';

export const PERMISSION_MODULES: PermissionModule[] = [
  'orders',
  'products',
  'content',
  'devices',
  'tickets',
  'affiliates',
  'vlb',
  'finance',
];

export type ProgramRole = 'affiliate' | 'investor';

export interface StaffPermission {
  module: string;
  can_view: boolean;
  can_edit: boolean;
}

export interface AuthRequest extends Request {
  user?: any;
  permissions?: StaffPermission[];
  programRoles?: ProgramRole[];
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(res, 'Unauthorized - No token provided', 401);
    }

    const token = authHeader.substring(7);

    // Verify token with Supabase
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return errorResponse(res, 'Unauthorized - Invalid token', 401);
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return errorResponse(res, 'User profile not found', 404);
    }

    req.user = profile;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return errorResponse(res, 'Authentication failed', 500);
  }
};

export const isAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return errorResponse(res, 'Forbidden - Admin access required', 403);
  }

  next();
};

export const requireAdmin = [authenticate, isAdmin];

const isSuperadmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  if (req.user.role !== 'superadmin') {
    return errorResponse(res, 'Forbidden - Superadmin access required', 403);
  }

  next();
};

export const requireSuperadmin = [authenticate, isSuperadmin];

const isStaff = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  if (!['staff', 'admin', 'superadmin'].includes(req.user.role)) {
    return errorResponse(res, 'Forbidden - Staff access required', 403);
  }

  next();
};

export const requireStaff = [authenticate, isStaff];

async function loadStaffPermissions(req: AuthRequest): Promise<StaffPermission[]> {
  if (req.permissions) {
    return req.permissions;
  }

  const { data, error } = await supabaseAdmin
    .from('staff_permissions')
    .select('module, can_view, can_edit')
    .eq('user_id', req.user.id);

  if (error) {
    throw error;
  }

  req.permissions = data || [];
  return req.permissions;
}

function allowsLevel(row: StaffPermission | undefined, level: PermissionLevel): boolean {
  return level === 'view' ? row?.can_view === true : row?.can_edit === true;
}

export async function staffHasModuleAccess(
  req: AuthRequest,
  module: PermissionModule,
  level: PermissionLevel
): Promise<boolean> {
  if (req.user?.role !== 'staff') {
    return false;
  }

  const permissions = await loadStaffPermissions(req);
  const row = permissions.find((permission) => permission.module === module);
  return allowsLevel(row, level);
}

export const requirePermission = (module: PermissionModule, level: PermissionLevel) => {
  const checkPermission = async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return errorResponse(res, 'Unauthorized', 401);
    }

    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      return next();
    }

    if (req.user.role !== 'staff') {
      return errorResponse(res, 'Forbidden - Permission required', 403);
    }

    try {
      const allowed = await staffHasModuleAccess(req, module, level);

      if (!allowed) {
        return errorResponse(res, 'Forbidden - Permission required', 403);
      }

      return next();
    } catch (error) {
      console.error('Permission check error:', error);
      return errorResponse(res, 'Failed to check permissions', 500);
    }
  };

  return [authenticate, checkPermission];
};

export const requireAnyPermission = (modules: PermissionModule[], level: PermissionLevel) => {
  const checkAnyPermission = async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return errorResponse(res, 'Unauthorized', 401);
    }

    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      return next();
    }

    if (req.user.role !== 'staff') {
      return errorResponse(res, 'Forbidden - Permission required', 403);
    }

    try {
      const permissions = await loadStaffPermissions(req);
      const allowed = modules.some((module) => {
        const row = permissions.find((permission) => permission.module === module);
        return allowsLevel(row, level);
      });

      if (!allowed) {
        return errorResponse(res, 'Forbidden - Permission required', 403);
      }

      return next();
    } catch (error) {
      console.error('Permission check error:', error);
      return errorResponse(res, 'Failed to check permissions', 500);
    }
  };

  return [authenticate, checkAnyPermission];
};

async function loadProgramRoles(req: AuthRequest): Promise<ProgramRole[]> {
  if (req.programRoles) {
    return req.programRoles;
  }

  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', req.user.id)
    .eq('status', 'active');

  if (error) {
    throw error;
  }

  req.programRoles = (data || [])
    .map((row) => row.role)
    .filter((role): role is ProgramRole => role === 'affiliate' || role === 'investor');

  return req.programRoles;
}

export const requireProgramRole = (role: ProgramRole) => {
  const checkProgramRole = async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return errorResponse(res, 'Unauthorized', 401);
    }

    try {
      const roles = await loadProgramRoles(req);

      if (!roles.includes(role)) {
        return errorResponse(res, 'Forbidden - Program role required', 403);
      }

      return next();
    } catch (error) {
      console.error('Program role check error:', error);
      return errorResponse(res, 'Failed to check program role', 500);
    }
  };

  return [authenticate, checkProgramRole];
};

// Attaches req.user when a valid token is sent, but lets guests through.
export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  try {
    const {
      data: { user },
    } = await supabaseAdmin.auth.getUser(authHeader.substring(7));

    if (user) {
      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();
      if (profile) req.user = profile;
    }
  } catch (error) {
    console.error('Optional authentication error:', error);
  }

  next();
};



