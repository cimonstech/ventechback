import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { errorResponse } from '../utils/responseHandlers';

export interface AuthRequest extends Request {
  user?: any;
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

  if (req.user.role !== 'admin') {
    return errorResponse(res, 'Forbidden - Admin access required', 403);
  }

  next();
};

export const requireAdmin = [authenticate, isAdmin];

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



