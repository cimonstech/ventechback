import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { errorResponse } from '../utils/responseHandlers';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '../config/env';

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

    // 🔐 Verify JWT using Supabase JWT secret
    let decoded: any;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      return errorResponse(res, 'Unauthorized - Invalid token', 401);
    }

    if (!decoded || !decoded.sub) {
      return errorResponse(res, 'Unauthorized - Invalid token payload', 401);
    }

    // 🔎 Fetch user profile from DB
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', decoded.sub)
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

export const isAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  if (req.user.role !== 'admin') {
    return errorResponse(res, 'Forbidden - Admin access required', 403);
  }

  next();
};

// Affiliate verification
export const requireAffiliate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  try {
    const { data: affiliate, error } = await supabaseAdmin
      .from('affiliates')
      .select('status')
      .eq('user_id', req.user.id)
      .single();

    if (error || !affiliate) {
      return errorResponse(res, 'Affiliate account not found', 403);
    }

    if (affiliate.status !== 'active') {
      return errorResponse(
        res,
        `Affiliate account is ${affiliate.status}. Please contact support.`,
        403
      );
    }

    next();
  } catch (error) {
    console.error('Affiliate verification error:', error);
    return errorResponse(res, 'Failed to verify affiliate status', 500);
  }
};