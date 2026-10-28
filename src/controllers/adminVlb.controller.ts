import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest, staffHasModuleAccess } from '../middleware/auth.middleware';
import pdfService from '../services/pdf.service';
import {
  applyReferralBonus,
  deleteInvestorDocument,
  getAgreementTemplateAdmin,
  getApplication,
  getInvestmentAdmin,
  getInvestorAdmin,
  listApplications,
  listInvestments,
  listInvestors,
  listPayoutQueue,
  listSettlementQueue,
  listUpgradeRequests,
  markPayoutPaid,
  patchApplication,
  patchUpgradeRequest,
  payoutsCsv,
  payoutsReport,
  recordStarRedemption,
  renewInvestment,
  scholarFundCsv,
  scholarFundReport,
  settleInvestment,
  signAdminDocument,
  updateInvestorPayoutByStaff,
  uploadAgreementTemplate,
  uploadInvestorDocument,
} from '../services/vlbAdmin.service';
import {
  confirmationPayloadAdmin,
  payoutReceiptPayload,
  statementPayloadAdmin,
} from '../services/vlbInvestor.service';
import {
  VlbError,
  activateApplication,
  createPlan,
  listAdminPlans,
  previewPlanSchedule,
  updatePlan,
} from '../services/vlb.service';
import { errorResponse, paginatedResponse, successResponse } from '../utils/responseHandlers';

const rateBasis = z.enum(['per_month', 'per_term']);
const payoutFrequency = z.enum(['monthly', 'end_of_term']);
const scholarBasis = z.enum(['gross_payout', 'principal']);

const createPlanSchema = z.object({
  plan_group: z.enum(['vts', 'exclusive']),
  tier: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  principal_pesewas: z.number().int().positive().max(100_000_000_000),
  version: z.string().trim().min(1).max(20).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
  terms_count: z.number().int().min(1).max(24).optional(),
  months_per_term: z.number().int().min(1).max(24).optional(),
  settlement_months: z.number().int().min(0).max(24).optional(),
  term_rates_percent: z.array(z.number().min(0).max(100)).min(1).max(24).optional(),
  rate_basis: rateBasis.optional(),
  payout_frequency: payoutFrequency.optional(),
  scholar_fund_percent: z.number().min(0).max(100).optional(),
  scholar_fund_basis: scholarBasis.optional(),
  premium_stars: z.number().int().min(0).max(1000).optional(),
  referral_bonus_percent: z.number().min(0).max(100).optional(),
});

const updatePlanSchema = createPlanSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Nothing to update' }
);

const momoPayoutSchema = z.object({
  payout_method: z.literal('momo'),
  momo_network: z.string().trim().min(1).max(40),
  momo_number: z.string().trim().min(8).max(20),
});

const bankPayoutSchema = z.object({
  payout_method: z.literal('bank'),
  bank_name: z.string().trim().min(1).max(80),
  bank_account_name: z.string().trim().min(1).max(120),
  bank_account_number: z.string().trim().min(6).max(32),
});

const payoutSchema = z.discriminatedUnion('payout_method', [momoPayoutSchema, bankPayoutSchema]);

const activateSchema = z.object({
  email: z.string().trim().email().max(200),
  plan_id: z.uuid(),
  principal_pesewas: z.number().int().positive().max(100_000_000_000),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_method: z.string().trim().min(1).max(80),
  payment_reference: z.string().trim().min(1).max(120),
  agreement_signed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payout: payoutSchema.optional(),
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

function routeId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export async function adminListPlans(_req: AuthRequest, res: Response) {
  try {
    const plans = await listAdminPlans();
    return successResponse(res, plans);
  } catch (error) {
    return fail(res, error, 'Could not load plans.');
  }
}

export async function adminCreatePlan(req: AuthRequest, res: Response) {
  try {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const plan = await createPlan(req, parsed.data);
    return successResponse(res, plan, 'Plan created.', 201);
  } catch (error) {
    return fail(res, error, 'Could not create this plan.');
  }
}

export async function adminUpdatePlan(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) {
      return errorResponse(res, 'Plan not found.', 404);
    }
    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const result = await updatePlan(req, id, parsed.data);
    return successResponse(
      res,
      result.plan,
      result.versioned ? 'New plan version created.' : 'Plan updated.'
    );
  } catch (error) {
    return fail(res, error, 'Could not update this plan.');
  }
}

export async function adminActivateApplication(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) {
      return errorResponse(res, 'Application not found.', 404);
    }
    const parsed = activateSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const { payout, ...activation } = parsed.data;
    const result = await activateApplication(req, id, {
      ...activation,
      allow_principal_override: req.user?.role === 'superadmin',
    });
    if (payout) {
      await updateInvestorPayoutByStaff(req, result.investor_id, payout);
    }
    return successResponse(res, result, 'Investment activated.');
  } catch (error) {
    return fail(res, error, 'Could not activate this investment.');
  }
}

const applicationPatchSchema = z.object({
  status: z.enum(['new', 'contacted', 'declined']).optional(),
  notes: z.string().trim().max(4000).optional().nullable(),
}).refine((value) => value.status !== undefined || value.notes !== undefined, {
  message: 'Nothing to update',
});

const markPaidSchema = z.object({
  method: z.string().trim().min(1).max(80),
  reference: z.string().trim().min(1).max(120),
  paid_at: z.string().trim().min(10).max(40).optional(),
});

const starsSchema = z.object({
  product_note: z.string().trim().min(1).max(500),
  order_id: z.uuid().optional().nullable(),
});

const referralSchema = z.object({
  referred_investment_id: z.uuid(),
});

const upgradePatchSchema = z.object({
  status: z.enum(['new', 'contacted', 'done', 'declined']),
});

const documentKind = z.enum(['agreement', 'receipt', 'statement', 'other']);

function queryValue(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

function pageLimit(req: AuthRequest) {
  const page = Math.max(1, parseInt(queryValue(req.query.page) || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(queryValue(req.query.limit) || '20', 10) || 20));
  return { page, limit };
}

function dateRange(req: AuthRequest): { from: string; to: string } | null {
  const from = queryValue(req.query.from);
  const to = queryValue(req.query.to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return null;
  return { from, to };
}

async function canSeeFinance(req: AuthRequest): Promise<boolean> {
  if (req.user?.role === 'admin' || req.user?.role === 'superadmin') return true;
  return staffHasModuleAccess(req, 'finance', 'view');
}

export async function adminListApplications(req: AuthRequest, res: Response) {
  try {
    const { page, limit } = pageLimit(req);
    const data = await listApplications({ page, limit, status: queryValue(req.query.status) || undefined });
    return paginatedResponse(res, data.rows, {
      page,
      limit,
      total: data.total,
      totalPages: Math.max(1, Math.ceil(data.total / limit)),
    });
  } catch (error) {
    return fail(res, error, 'Could not load applications.');
  }
}

export async function adminGetApplication(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Application not found.', 404);
    const data = await getApplication(id);
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load this application.');
  }
}

export async function adminPatchApplication(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Application not found.', 404);
    const parsed = applicationPatchSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const data = await patchApplication(req, id, parsed.data);
    return successResponse(res, data, 'Application updated.');
  } catch (error) {
    return fail(res, error, 'Could not update this application.');
  }
}

export async function adminListInvestors(req: AuthRequest, res: Response) {
  try {
    const { page, limit } = pageLimit(req);
    const data = await listInvestors({ page, limit, search: queryValue(req.query.search) || undefined });
    return paginatedResponse(res, data.rows, {
      page,
      limit,
      total: data.total,
      totalPages: Math.max(1, Math.ceil(data.total / limit)),
    });
  } catch (error) {
    return fail(res, error, 'Could not load investors.');
  }
}

export async function adminGetInvestor(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investor not found.', 404);
    const data = await getInvestorAdmin(id, await canSeeFinance(req));
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load this investor.');
  }
}

export async function adminListInvestments(req: AuthRequest, res: Response) {
  try {
    const { page, limit } = pageLimit(req);
    const planId = queryValue(req.query.plan_id);
    const termRaw = queryValue(req.query.term);
    const term = termRaw ? parseInt(termRaw, 10) : undefined;
    const data = await listInvestments({
      page,
      limit,
      plan_id: z.uuid().safeParse(planId).success ? planId : undefined,
      status: queryValue(req.query.status) || undefined,
      term: term && Number.isInteger(term) ? term : undefined,
      maturity_month: queryValue(req.query.maturity_month) || undefined,
    });
    return paginatedResponse(res, data.rows, {
      page,
      limit,
      total: data.total,
      totalPages: Math.max(1, Math.ceil(data.total / limit)),
    });
  } catch (error) {
    return fail(res, error, 'Could not load investments.');
  }
}

export async function adminGetInvestment(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investment not found.', 404);
    const data = await getInvestmentAdmin(id);
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load this investment.');
  }
}

export async function adminPreviewSchedule(req: AuthRequest, res: Response) {
  try {
    const planId = queryValue(req.query.plan_id);
    const startDate = queryValue(req.query.start_date);
    const principalRaw = queryValue(req.query.principal_pesewas);
    if (!z.uuid().safeParse(planId).success) return errorResponse(res, 'Plan not found.', 404);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return errorResponse(res, 'Enter a start date.', 400);
    const principal = principalRaw ? parseInt(principalRaw, 10) : undefined;
    const data = await previewPlanSchedule(planId, principal, startDate);
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not preview this schedule.');
  }
}

export async function adminListPayouts(req: AuthRequest, res: Response) {
  try {
    const range = queryValue(req.query.range) || 'due';
    if (!['this_week', 'overdue', 'due', 'all', 'paid'].includes(range)) {
      return errorResponse(res, 'That range is not available.', 400);
    }
    const { page, limit } = pageLimit(req);
    const data = await listPayoutQueue({
      range: range as 'this_week' | 'overdue' | 'due' | 'all' | 'paid',
      page,
      limit,
      includePayoutDetails: await canSeeFinance(req),
    });
    return paginatedResponse(res, data.rows, {
      page,
      limit,
      total: data.total,
      totalPages: Math.max(1, Math.ceil(data.total / limit)),
    });
  } catch (error) {
    return fail(res, error, 'Could not load payouts.');
  }
}

export async function adminMarkPayoutPaid(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Payout not found.', 404);
    const parsed = markPaidSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const data = await markPayoutPaid(req, id, parsed.data);
    return successResponse(res, data, 'Payout marked paid.');
  } catch (error) {
    return fail(res, error, 'Could not mark this payout paid.');
  }
}

export async function adminSettlementQueue(_req: AuthRequest, res: Response) {
  try {
    const data = await listSettlementQueue();
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load the settlement queue.');
  }
}

export async function adminSettleInvestment(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investment not found.', 404);
    const data = await settleInvestment(req, id);
    return successResponse(res, data, 'Investment settled.');
  } catch (error) {
    return fail(res, error, 'Could not settle this investment.');
  }
}

export async function adminRenewInvestment(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investment not found.', 404);
    const data = await renewInvestment(req, id);
    return successResponse(res, data, 'Investment renewed.');
  } catch (error) {
    return fail(res, error, 'Could not renew this investment.');
  }
}

export async function adminRecordStars(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investment not found.', 404);
    const parsed = starsSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const data = await recordStarRedemption(req, id, parsed.data);
    return successResponse(res, data, 'Star redemption recorded.', 201);
  } catch (error) {
    return fail(res, error, 'Could not record this redemption.');
  }
}

export async function adminReferralBonus(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investment not found.', 404);
    const parsed = referralSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const data = await applyReferralBonus(req, id, parsed.data.referred_investment_id);
    return successResponse(res, data, 'Referral bonus applied.');
  } catch (error) {
    return fail(res, error, 'Could not apply this referral bonus.');
  }
}

function sendPdf(res: Response, pdf: Buffer, filename: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(pdf);
}

export async function adminPatchInvestorPayout(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investor not found.', 404);
    const parsed = payoutSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const data = await updateInvestorPayoutByStaff(req, id, parsed.data);
    return successResponse(res, data, 'Payout details saved.');
  } catch (error) {
    return fail(res, error, 'Could not update payout details.');
  }
}

export async function adminGetAgreementTemplate(_req: AuthRequest, res: Response) {
  try {
    const data = await getAgreementTemplateAdmin();
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load the agreement template.');
  }
}

export async function adminUploadAgreementTemplate(req: AuthRequest, res: Response) {
  try {
    const file = req.file;
    if (!file?.buffer?.length) return errorResponse(res, 'Choose a file.', 400);
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const data = await uploadAgreementTemplate(req, { file, title: title || undefined });
    return successResponse(res, data, 'Agreement template saved.', 201);
  } catch (error) {
    return fail(res, error, 'Could not store this file.');
  }
}

export async function adminGetDocument(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Document not found.', 404);
    const data = await signAdminDocument(id);
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load this document.');
  }
}

export async function adminInvestmentConfirmationPdf(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investment not found.', 404);
    const payload = await confirmationPayloadAdmin(id);
    const pdf = await pdfService.generateVlbConfirmationPDF(payload);
    return sendPdf(res, pdf, `vlb-confirmation-${payload.investor_no}.pdf`);
  } catch (error) {
    return fail(res, error, 'Could not generate this confirmation.');
  }
}

export async function adminInvestmentStatementPdf(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investment not found.', 404);
    const payload = await statementPayloadAdmin(id);
    const pdf = await pdfService.generateVlbStatementPDF(payload);
    return sendPdf(res, pdf, `vlb-statement-${payload.investor_no}.pdf`);
  } catch (error) {
    return fail(res, error, 'Could not generate this statement.');
  }
}

export async function adminPayoutReceiptPdf(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Payout not found.', 404);
    const payload = await payoutReceiptPayload(id);
    const pdf = await pdfService.generateVlbPayoutReceiptPDF(payload);
    return sendPdf(res, pdf, `${payload.receipt_no}.pdf`);
  } catch (error) {
    return fail(res, error, 'Could not generate this receipt.');
  }
}

export async function adminUploadDocument(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investor not found.', 404);
    const file = req.file;
    if (!file?.buffer?.length) return errorResponse(res, 'Choose a file.', 400);
    const kind = documentKind.safeParse(req.body?.kind);
    if (!kind.success) return errorResponse(res, 'Choose a document kind.', 400);
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) return errorResponse(res, 'Enter a title.', 400);
    const investmentId = typeof req.body?.investment_id === 'string' ? req.body.investment_id.trim() : '';
    if (investmentId && !z.uuid().safeParse(investmentId).success) {
      return errorResponse(res, 'Investment not found.', 400);
    }
    const data = await uploadInvestorDocument(req, id, {
      file,
      kind: kind.data,
      title,
      investment_id: investmentId || null,
    });
    return successResponse(res, data, 'Document uploaded.', 201);
  } catch (error) {
    return fail(res, error, 'Could not store this file.');
  }
}

export async function adminDeleteDocument(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Document not found.', 404);
    const data = await deleteInvestorDocument(req, id);
    return successResponse(res, data, 'Document deleted.');
  } catch (error) {
    return fail(res, error, 'Could not delete this document.');
  }
}

export async function adminListUpgrades(req: AuthRequest, res: Response) {
  try {
    const { page, limit } = pageLimit(req);
    const data = await listUpgradeRequests({
      page,
      limit,
      status: queryValue(req.query.status) || undefined,
    });
    return paginatedResponse(res, data.rows, {
      page,
      limit,
      total: data.total,
      totalPages: Math.max(1, Math.ceil(data.total / limit)),
    });
  } catch (error) {
    return fail(res, error, 'Could not load upgrade requests.');
  }
}

export async function adminPatchUpgrade(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Upgrade request not found.', 404);
    const parsed = upgradePatchSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const data = await patchUpgradeRequest(req, id, parsed.data);
    return successResponse(res, data, 'Upgrade request updated.');
  } catch (error) {
    return fail(res, error, 'Could not update this upgrade request.');
  }
}

export async function adminScholarFundReport(req: AuthRequest, res: Response) {
  try {
    const range = dateRange(req);
    if (!range) return errorResponse(res, 'Provide from and to dates.', 400);
    const data = await scholarFundReport(range.from, range.to);
    if (queryValue(req.query.format) === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="vlb-scholar-fund.csv"');
      return res.status(200).send(scholarFundCsv(data));
    }
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load this report.');
  }
}

export async function adminPayoutsReport(req: AuthRequest, res: Response) {
  try {
    const range = dateRange(req);
    if (!range) return errorResponse(res, 'Provide from and to dates.', 400);
    const data = await payoutsReport(range.from, range.to);
    if (queryValue(req.query.format) === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="vlb-payouts.csv"');
      return res.status(200).send(payoutsCsv(data));
    }
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load this report.');
  }
}
