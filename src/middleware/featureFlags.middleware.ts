import { NextFunction, Request, Response } from 'express';
import {
  FEATURE_UNAVAILABLE,
  isAffiliatesEnabled,
  isVlbV3Enabled,
} from '../services/featureFlags.service';
import { errorResponse } from '../utils/responseHandlers';

export const FEATURE_OFF_CODE = 'feature_off';

export async function requireAffiliatesEnabled(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    if (!(await isAffiliatesEnabled())) {
      return errorResponse(res, FEATURE_UNAVAILABLE, 403, null, FEATURE_OFF_CODE);
    }
    return next();
  } catch (error) {
    console.error('affiliates feature flag', error);
    return errorResponse(res, 'Service temporarily unavailable.', 503);
  }
}

export async function requireVlbV3Enabled(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    if (!(await isVlbV3Enabled())) {
      return errorResponse(res, FEATURE_UNAVAILABLE, 403, null, FEATURE_OFF_CODE);
    }
    return next();
  } catch (error) {
    console.error('vlb feature flag', error);
    return errorResponse(res, 'Service temporarily unavailable.', 503);
  }
}
