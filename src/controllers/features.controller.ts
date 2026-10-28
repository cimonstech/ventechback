import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  getFeatureFlags,
  updateFeatureFlags,
} from '../services/featureFlags.service';
import { errorResponse, successResponse } from '../utils/responseHandlers';

const patchSchema = z
  .object({
    feature_affiliates_enabled: z.boolean().optional(),
    feature_vlb_v3_enabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.feature_affiliates_enabled !== undefined ||
      value.feature_vlb_v3_enabled !== undefined,
    { message: 'Nothing to update' }
  );

export async function getPublicFeatures(_req: Request, res: Response) {
  try {
    const data = await getFeatureFlags();
    return successResponse(res, data);
  } catch (error) {
    console.error('public features', error);
    return successResponse(res, {
      feature_affiliates_enabled: false,
      feature_vlb_v3_enabled: false,
    });
  }
}

export async function patchAdminFeatures(req: AuthRequest, res: Response) {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return errorResponse(res, 'Nothing to update', 400);
    }
    const data = await updateFeatureFlags(req, parsed.data);
    return successResponse(res, data, 'Feature flags saved.');
  } catch (error) {
    console.error('save feature flags', error);
    return errorResponse(res, 'Could not save feature flags.', 500);
  }
}
