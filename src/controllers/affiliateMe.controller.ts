import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';
import { AffiliateError } from '../services/affiliate.service';
import {
  getLedger,
  getMe,
  getSales,
  getSummary,
  getWithdrawals,
  requestWithdrawal,
  searchProducts,
  updatePayout,
  updateWithdrawalMode,
} from '../services/affiliateWallet.service';
import { errorResponse, paginatedResponse, successResponse } from '../utils/responseHandlers';

const momoSchema = z.object({
  payout_method: z.literal('momo'),
  momo_network: z.string().trim().min(1).max(40),
  momo_number: z.string().trim().min(8).max(20),
});

const bankSchema = z.object({
  payout_method: z.literal('bank'),
  bank_name: z.string().trim().min(1).max(80),
  bank_account_name: z.string().trim().min(1).max(120),
  bank_account_number: z.string().trim().min(6).max(32),
});

const payoutSchema = z.discriminatedUnion('payout_method', [momoSchema, bankSchema]);
const modeSchema = z.object({
  withdrawal_mode: z.enum(['anytime', 'month_end']),
});
const withdrawSchema = z.object({
  amount_pesewas: z.number().int().positive(),
});

function formMessage(error: z.ZodError): string {
  const message = error.issues[0]?.message || '';
  if (!message || /invalid|expected|received/i.test(message)) return 'Check the form and try again.';
  return message;
}

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof AffiliateError) {
    return errorResponse(res, error.message, error.statusCode, null, error.code);
  }
  console.error(fallback, error);
  return errorResponse(res, fallback, 500);
}

function pageLimit(req: AuthRequest) {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
  return { page, limit };
}

function userId(req: AuthRequest): string {
  return req.user.id as string;
}

export async function getAffiliateMe(req: AuthRequest, res: Response) {
  try {
    const data = await getMe(userId(req));
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load your affiliate account.');
  }
}

export async function getAffiliateSummary(req: AuthRequest, res: Response) {
  try {
    const data = await getSummary(userId(req));
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load your summary.');
  }
}

export async function getAffiliateSales(req: AuthRequest, res: Response) {
  try {
    const { page, limit } = pageLimit(req);
    const data = await getSales(userId(req), page, limit);
    return paginatedResponse(res, data.rows, {
      page,
      limit,
      total: data.total,
      totalPages: Math.max(1, Math.ceil(data.total / limit)),
    });
  } catch (error) {
    return fail(res, error, 'Could not load your sales.');
  }
}

export async function getAffiliateLedger(req: AuthRequest, res: Response) {
  try {
    const { page, limit } = pageLimit(req);
    const data = await getLedger(userId(req), page, limit);
    return paginatedResponse(res, data.rows, {
      page,
      limit,
      total: data.total,
      totalPages: Math.max(1, Math.ceil(data.total / limit)),
    });
  } catch (error) {
    return fail(res, error, 'Could not load your ledger.');
  }
}

export async function getAffiliateWithdrawals(req: AuthRequest, res: Response) {
  try {
    const { page, limit } = pageLimit(req);
    const data = await getWithdrawals(userId(req), page, limit);
    return paginatedResponse(res, data.rows, {
      page,
      limit,
      total: data.total,
      totalPages: Math.max(1, Math.ceil(data.total / limit)),
    });
  } catch (error) {
    return fail(res, error, 'Could not load your withdrawals.');
  }
}

export async function patchPayout(req: AuthRequest, res: Response) {
  try {
    const parsed = payoutSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const data = await updatePayout(req, userId(req), parsed.data);
    return successResponse(res, data, 'Payout details updated.');
  } catch (error) {
    return fail(res, error, 'Could not update payout details.');
  }
}

export async function patchWithdrawalMode(req: AuthRequest, res: Response) {
  try {
    const parsed = modeSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const data = await updateWithdrawalMode(req, userId(req), parsed.data.withdrawal_mode);
    return successResponse(res, data, 'Withdrawal mode updated.');
  } catch (error) {
    return fail(res, error, 'Could not update withdrawal mode.');
  }
}

export async function postWithdrawal(req: AuthRequest, res: Response) {
  try {
    const parsed = withdrawSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, 'Enter a valid withdrawal amount.', 400);
    const data = await requestWithdrawal(req, userId(req), parsed.data.amount_pesewas);
    return successResponse(res, data, 'Withdrawal requested.', 201);
  } catch (error) {
    return fail(res, error, 'Could not request this withdrawal.');
  }
}

export async function getProductSearch(req: AuthRequest, res: Response) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const data = await searchProducts(userId(req), q);
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not search products.');
  }
}
