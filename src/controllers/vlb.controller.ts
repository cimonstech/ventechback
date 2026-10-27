import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  VlbError,
  listPublicPlans,
  submitApplication,
} from '../services/vlb.service';
import { errorResponse, successResponse } from '../utils/responseHandlers';

const applicationSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(8).max(30),
  plan_id: z.uuid(),
  message: z.string().trim().max(2000).optional().nullable(),
});

function formMessage(error: z.ZodError): string {
  const message = error.issues[0]?.message || '';
  if (!message || /invalid|expected|received/i.test(message)) return 'Check the form and try again.';
  return message;
}

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof VlbError) {
    return errorResponse(res, error.message, error.statusCode);
  }
  console.error(fallback, error);
  return errorResponse(res, fallback, 500);
}

export async function getPublicPlans(_req: AuthRequest, res: Response) {
  try {
    const plans = await listPublicPlans();
    return successResponse(res, plans);
  } catch (error) {
    return fail(res, error, 'Could not load plans.');
  }
}

export async function postApplication(req: AuthRequest, res: Response) {
  try {
    const parsed = applicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return errorResponse(res, formMessage(parsed.error), 400);
    }
    const application = await submitApplication({
      ...parsed.data,
      user_id: req.user?.id || null,
    });
    return successResponse(res, { id: application.id }, 'Application received.', 201);
  } catch (error) {
    return fail(res, error, 'Could not save this application.');
  }
}
