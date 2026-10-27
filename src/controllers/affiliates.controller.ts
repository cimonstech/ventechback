import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  AffiliateError,
  initializeAffiliateFee,
  presentAffiliate,
  registerAffiliate,
  trackClick,
  verifyAffiliateFee,
} from '../services/affiliate.service';
import { errorResponse, successResponse } from '../utils/responseHandlers';

const momoSchema = z.object({
  promo_channels: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  social_handles: z.record(z.string().trim().min(1).max(80), z.string().trim().max(200)).optional().default({}),
  payout_method: z.literal('momo'),
  momo_network: z.string().trim().min(1).max(40),
  momo_number: z.string().trim().min(8).max(20),
  accept_terms: z.literal(true),
});

const bankSchema = z.object({
  promo_channels: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  social_handles: z.record(z.string().trim().min(1).max(80), z.string().trim().max(200)).optional().default({}),
  payout_method: z.literal('bank'),
  bank_name: z.string().trim().min(1).max(80),
  bank_account_name: z.string().trim().min(1).max(120),
  bank_account_number: z.string().trim().min(6).max(32),
  accept_terms: z.literal(true),
});

const registerSchema = z.discriminatedUnion('payout_method', [momoSchema, bankSchema]);

const verifySchema = z.object({
  reference: z.string().trim().min(6).max(100),
});

const clickSchema = z.object({
  code: z.string().trim().min(1).max(20),
  landing_url: z.string().trim().min(1).max(2000),
  product_slug: z.string().trim().min(1).max(200).optional(),
});

function formMessage(error: z.ZodError): string {
  const message = error.issues[0]?.message || '';
  if (!message || /invalid|expected|received/i.test(message)) return 'Check the form and try again.';
  return message;
}

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof AffiliateError) {
    return errorResponse(res, error.message, error.statusCode);
  }
  console.error(fallback, error);
  return errorResponse(res, fallback, 500);
}

export async function postRegister(req: AuthRequest, res: Response) {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      const accept = parsed.error.issues.find((issue) => issue.path.includes('accept_terms'));
      if (accept) return errorResponse(res, 'You must accept the affiliate terms.', 400);
      return errorResponse(res, formMessage(parsed.error), 400);
    }
    const affiliate = await registerAffiliate(req, parsed.data);
    return successResponse(res, presentAffiliate(affiliate), 'Affiliate application saved.');
  } catch (error) {
    return fail(res, error, 'Could not save your affiliate application.');
  }
}

export async function postFeeInitialize(req: AuthRequest, res: Response) {
  try {
    const data = await initializeAffiliateFee(req);
    return successResponse(res, data, 'Payment initialized.');
  } catch (error) {
    return fail(res, error, 'Could not start the payment.');
  }
}

export async function postFeeVerify(req: AuthRequest, res: Response) {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, 'A payment reference is required.', 400);
    const result = await verifyAffiliateFee(req, parsed.data.reference);
    return successResponse(res, presentAffiliate(result.affiliate), 'Payment recorded.');
  } catch (error) {
    return fail(res, error, 'Could not verify this payment.');
  }
}

export async function postRefClick(req: Request, res: Response) {
  try {
    const parsed = clickSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, 'Not found.', 404);
    const data = await trackClick(req, parsed.data);
    return successResponse(res, data, 'Click recorded.');
  } catch (error) {
    if (error instanceof AffiliateError) {
      return errorResponse(res, error.statusCode === 503 ? error.message : 'Not found.', error.statusCode === 503 ? 503 : 404);
    }
    console.error('affiliate click', error);
    return errorResponse(res, 'Not found.', 404);
  }
}
