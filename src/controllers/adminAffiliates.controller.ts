import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';
import { AffiliateError } from '../services/affiliate.service';
import {
  approveAffiliate,
  approveCommissionAdmin,
  exportCsv,
  getAffiliate,
  getMetrics,
  getSettingsPublic,
  listAffiliates,
  listCommissions,
  listWithdrawalsAdmin,
  reactivateAffiliate,
  recordFeeRefund,
  rejectAffiliate,
  reverseCommissionAdmin,
  saveSettings,
  suspendAffiliate,
  updateWithdrawalStatus,
} from '../services/adminAffiliates.service';
import { affiliateSettings } from '../services/affiliateSettings.service';
import { errorResponse, paginatedResponse, successResponse } from '../utils/responseHandlers';

const STATUSES = ['awaiting_payment', 'pending', 'active', 'suspended', 'rejected'] as const;
const COMMISSION_STATUSES = ['pending', 'approved', 'reversed'] as const;
const WITHDRAWAL_STATUSES = ['requested', 'processing', 'approved', 'paid', 'rejected'] as const;

const reasonSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
const refundSchema = z.object({
  reference: z.string().trim().min(4).max(100),
});
const reverseSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
const withdrawalStatusSchema = z.object({
  to: z.enum(['processing', 'approved', 'paid', 'rejected']),
  reason: z.string().trim().min(1).max(500).optional(),
  payment_reference: z.string().trim().min(1).max(100).optional(),
});
const settingsSchema = z
  .object({
    affiliate_fee_pesewas: z.number().int().min(0).max(10_000_000).optional(),
    affiliate_commission_pesewas: z.number().int().min(1).max(10_000_000).optional(),
    affiliate_activation_mode: z.enum(['approval', 'automatic']).optional(),
    affiliate_fee_refund_on_rejection: z.boolean().optional(),
    affiliate_eligible_scope: z.enum(['all', 'categories']).optional(),
    affiliate_eligible_category_slugs: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
    affiliate_commission_mode: z.enum(['flat', 'percent']).optional(),
    affiliate_commission_percent_bp: z.number().int().min(0).max(5000).optional(),
    affiliate_commission_cap_pesewas: z.number().int().min(1).max(100_000_000).nullable().optional(),
    affiliate_min_order_pesewas: z.number().int().min(0).max(100_000_000).optional(),
    affiliate_attribution_days: z.number().int().min(1).max(365).optional(),
    affiliate_return_window_days: z.number().int().min(0).max(90).optional(),
    affiliate_withdrawal_min_pesewas: z.number().int().min(0).max(10_000_000).optional(),
    affiliate_payout_change_hold_hours: z.number().int().min(0).max(720).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

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

function queryValue(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

function pageLimit(req: AuthRequest) {
  const page = Math.max(1, parseInt(queryValue(req.query.page) || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(queryValue(req.query.limit) || '20', 10) || 20));
  return { page, limit };
}

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function settingsToStrings(body: z.infer<typeof settingsSchema>): Record<string, string> {
  const out: Record<string, string> = {};
  if (body.affiliate_fee_pesewas !== undefined) out.affiliate_fee_pesewas = String(body.affiliate_fee_pesewas);
  if (body.affiliate_commission_pesewas !== undefined) {
    out.affiliate_commission_pesewas = String(body.affiliate_commission_pesewas);
  }
  if (body.affiliate_activation_mode !== undefined) {
    out.affiliate_activation_mode = body.affiliate_activation_mode;
  }
  if (body.affiliate_fee_refund_on_rejection !== undefined) {
    out.affiliate_fee_refund_on_rejection = body.affiliate_fee_refund_on_rejection ? 'true' : 'false';
  }
  if (body.affiliate_eligible_scope !== undefined) {
    out.affiliate_eligible_scope = body.affiliate_eligible_scope;
  }
  if (body.affiliate_eligible_category_slugs !== undefined) {
    out.affiliate_eligible_category_slugs = body.affiliate_eligible_category_slugs.join(',');
  }
  if (body.affiliate_commission_mode !== undefined) {
    out.affiliate_commission_mode = body.affiliate_commission_mode;
  }
  if (body.affiliate_commission_percent_bp !== undefined) {
    out.affiliate_commission_percent_bp = String(body.affiliate_commission_percent_bp);
  }
  if (body.affiliate_commission_cap_pesewas !== undefined) {
    out.affiliate_commission_cap_pesewas =
      body.affiliate_commission_cap_pesewas == null ? '' : String(body.affiliate_commission_cap_pesewas);
  }
  if (body.affiliate_min_order_pesewas !== undefined) {
    out.affiliate_min_order_pesewas = String(body.affiliate_min_order_pesewas);
  }
  if (body.affiliate_attribution_days !== undefined) {
    out.affiliate_attribution_days = String(body.affiliate_attribution_days);
  }
  if (body.affiliate_return_window_days !== undefined) {
    out.affiliate_return_window_days = String(body.affiliate_return_window_days);
  }
  if (body.affiliate_withdrawal_min_pesewas !== undefined) {
    out.affiliate_withdrawal_min_pesewas = String(body.affiliate_withdrawal_min_pesewas);
  }
  if (body.affiliate_payout_change_hold_hours !== undefined) {
    out.affiliate_payout_change_hold_hours = String(body.affiliate_payout_change_hold_hours);
  }
  return out;
}

export async function adminListAffiliates(req: AuthRequest, res: Response) {
  try {
    const status = queryValue(req.query.status);
    if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      return errorResponse(res, 'That status is not available.', 400);
    }
    const { page, limit } = pageLimit(req);
    const data = await listAffiliates({ page, limit, status: status || undefined, search: queryValue(req.query.search) });
    return paginatedResponse(res, data.rows, {
      page,
      limit,
      total: data.total,
      totalPages: Math.max(1, Math.ceil(data.total / limit)),
    });
  } catch (error) {
    return fail(res, error, 'Could not load affiliates.');
  }
}

export async function adminGetAffiliate(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Affiliate not found.', 404);
    const data = await getAffiliate(id);
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load this affiliate.');
  }
}

export async function adminApprove(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Affiliate not found.', 404);
    const data = await approveAffiliate(req, id);
    return successResponse(res, data, 'Affiliate approved.');
  } catch (error) {
    return fail(res, error, 'Could not approve this affiliate.');
  }
}

export async function adminReject(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Affiliate not found.', 404);
    const parsed = reasonSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, 'A reason is required.', 400);
    const data = await rejectAffiliate(req, id, parsed.data.reason);
    return successResponse(res, data, 'Affiliate rejected.');
  } catch (error) {
    return fail(res, error, 'Could not reject this affiliate.');
  }
}

export async function adminFeeRefunded(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Affiliate not found.', 404);
    const parsed = refundSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, 'A refund reference is required.', 400);
    const data = await recordFeeRefund(req, id, parsed.data.reference);
    return successResponse(res, data, 'Fee refund recorded.');
  } catch (error) {
    return fail(res, error, 'Could not record this refund.');
  }
}

export async function adminSuspend(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Affiliate not found.', 404);
    const parsed = reasonSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, 'A reason is required.', 400);
    const data = await suspendAffiliate(req, id, parsed.data.reason);
    return successResponse(res, data, 'Affiliate suspended.');
  } catch (error) {
    return fail(res, error, 'Could not suspend this affiliate.');
  }
}

export async function adminReactivate(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Affiliate not found.', 404);
    const data = await reactivateAffiliate(req, id);
    return successResponse(res, data, 'Affiliate reactivated.');
  } catch (error) {
    return fail(res, error, 'Could not reactivate this affiliate.');
  }
}

export async function adminListCommissions(req: AuthRequest, res: Response) {
  try {
    const status = queryValue(req.query.status);
    if (status && !COMMISSION_STATUSES.includes(status as (typeof COMMISSION_STATUSES)[number])) {
      return errorResponse(res, 'That status is not available.', 400);
    }
    const ready = queryValue(req.query.ready) === 'true' || queryValue(req.query.ready) === '1';
    const { page, limit } = pageLimit(req);
    const data = await listCommissions({ page, limit, status: status || undefined, ready });
    return paginatedResponse(res, data.rows, {
      page,
      limit,
      total: data.total,
      totalPages: Math.max(1, Math.ceil(data.total / limit)),
    });
  } catch (error) {
    return fail(res, error, 'Could not load commissions.');
  }
}

export async function adminApproveCommission(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Commission not found.', 404);
    const data = await approveCommissionAdmin(req, id);
    return successResponse(res, data, 'Commission approved.');
  } catch (error) {
    return fail(res, error, 'Could not approve this commission.');
  }
}

export async function adminReverseCommission(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Commission not found.', 404);
    const parsed = reverseSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, 'A reason is required.', 400);
    const data = await reverseCommissionAdmin(req, id, parsed.data.reason);
    return successResponse(res, data, 'Commission reversed.');
  } catch (error) {
    return fail(res, error, 'Could not reverse this commission.');
  }
}

export async function adminListWithdrawals(req: AuthRequest, res: Response) {
  try {
    const status = queryValue(req.query.status);
    if (status && !WITHDRAWAL_STATUSES.includes(status as (typeof WITHDRAWAL_STATUSES)[number])) {
      return errorResponse(res, 'That status is not available.', 400);
    }
    const { page, limit } = pageLimit(req);
    const data = await listWithdrawalsAdmin({ page, limit, status: status || undefined });
    return paginatedResponse(res, data.rows, {
      page,
      limit,
      total: data.total,
      totalPages: Math.max(1, Math.ceil(data.total / limit)),
    });
  } catch (error) {
    return fail(res, error, 'Could not load withdrawals.');
  }
}

export async function adminWithdrawalStatus(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Withdrawal not found.', 404);
    const parsed = withdrawalStatusSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    if (parsed.data.to === 'rejected' && !parsed.data.reason) {
      return errorResponse(res, 'A reason is required.', 400);
    }
    const data = await updateWithdrawalStatus(req, id, parsed.data);
    return successResponse(res, data, 'Withdrawal updated.');
  } catch (error) {
    return fail(res, error, 'Could not update this withdrawal.');
  }
}

export async function adminMetrics(_req: AuthRequest, res: Response) {
  try {
    const data = await getMetrics();
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load metrics.');
  }
}

export async function adminExport(req: AuthRequest, res: Response) {
  try {
    const kind = param(req.params.kind);
    if (kind !== 'affiliates' && kind !== 'commissions' && kind !== 'withdrawals') {
      return errorResponse(res, 'That export is not available.', 404);
    }
    const status = queryValue(req.query.status);
    const ready = queryValue(req.query.ready) === 'true' || queryValue(req.query.ready) === '1';
    const csv = await exportCsv(kind, {
      status: status || undefined,
      search: queryValue(req.query.search),
      ready,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}.csv"`);
    return res.status(200).send(csv);
  } catch (error) {
    return fail(res, error, 'Could not export this file.');
  }
}

export async function adminGetSettings(_req: AuthRequest, res: Response) {
  try {
    const data = await getSettingsPublic();
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load settings.');
  }
}

export async function adminPutSettings(req: AuthRequest, res: Response) {
  try {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const current = await affiliateSettings.get();
    const scope = parsed.data.affiliate_eligible_scope || current.eligibleScope;
    const slugs =
      parsed.data.affiliate_eligible_category_slugs !== undefined
        ? parsed.data.affiliate_eligible_category_slugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean)
        : current.eligibleCategorySlugs;
    if (scope === 'categories') {
      if (slugs.length === 0) {
        return errorResponse(res, 'Choose at least one category.', 400);
      }
      const existing = await affiliateSettings.existingCategorySlugs(slugs);
      const missing = slugs.filter((slug) => !existing.includes(slug));
      if (missing.length) {
        return errorResponse(res, 'Those categories were not found.', 400);
      }
    }
    const data = await saveSettings(req, settingsToStrings(parsed.data));
    return successResponse(res, data, 'Settings saved.');
  } catch (error) {
    return fail(res, error, 'Could not save settings.');
  }
}
