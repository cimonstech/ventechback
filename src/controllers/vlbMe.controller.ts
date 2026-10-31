import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';
import pdfService from '../services/pdf.service';
import { VlbError } from '../services/vlb.service';
import {
  chooseRenewal,
  confirmationPayload,
  createUpgradeRequest,
  getInvestorMe,
  getMyInvestment,
  listMyDocuments,
  payoutReceiptPayload,
  signMyDocument,
  statementPayload,
  updateInvestorPayout,
} from '../services/vlbInvestor.service';
import { errorResponse, successResponse } from '../utils/responseHandlers';

const renewalSchema = z.object({
  choice: z.enum(['settle', 'renew']),
});

const upgradeSchema = z.object({
  requested_plan_id: z.uuid(),
  message: z.string().trim().max(2000).optional().nullable(),
});

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

function formMessage(error: z.ZodError): string {
  const message = error.issues[0]?.message || '';
  if (!message || /invalid|expected|received/i.test(message)) return 'Check the form and try again.';
  return message;
}

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof VlbError) {
    return errorResponse(res, error.message, error.statusCode, null, error.code);
  }
  console.error(fallback, error);
  return errorResponse(res, fallback, 500);
}

function routeId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function userId(req: AuthRequest): string {
  return req.user.id as string;
}

export async function getVlbMe(req: AuthRequest, res: Response) {
  try {
    const data = await getInvestorMe(userId(req));
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load your investor account.');
  }
}

export async function getVlbMyInvestment(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investment not found.', 404);
    const data = await getMyInvestment(userId(req), id);
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load this investment.');
  }
}

export async function postVlbRenewal(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investment not found.', 404);
    const parsed = renewalSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const data = await chooseRenewal(req, userId(req), id, parsed.data.choice);
    return successResponse(res, data, 'Renewal choice saved.');
  } catch (error) {
    return fail(res, error, 'Could not save your renewal choice.');
  }
}

export async function postVlbUpgradeRequest(req: AuthRequest, res: Response) {
  try {
    const parsed = upgradeSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const data = await createUpgradeRequest(req, userId(req), parsed.data);
    return successResponse(res, data, 'Upgrade request sent.', 201);
  } catch (error) {
    return fail(res, error, 'Could not save this upgrade request.');
  }
}

export async function getVlbMyDocuments(req: AuthRequest, res: Response) {
  try {
    const data = await listMyDocuments(userId(req));
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load your documents.');
  }
}

export async function getVlbMyDocument(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Document not found.', 404);
    const data = await signMyDocument(userId(req), id);
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load this document.');
  }
}

function sendPdf(res: Response, pdf: Buffer, filename: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(pdf);
}

export async function getVlbStatementPdf(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investment not found.', 404);
    const payload = await statementPayload(userId(req), id);
    const pdf = await pdfService.generateVlbStatementPDF(payload);
    return sendPdf(res, pdf, `vlb-statement-${payload.investor_no}.pdf`);
  } catch (error) {
    return fail(res, error, 'Could not generate this statement.');
  }
}

export async function getVlbConfirmationPdf(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Investment not found.', 404);
    const payload = await confirmationPayload(userId(req), id);
    const pdf = await pdfService.generateVlbConfirmationPDF(payload);
    return sendPdf(res, pdf, `vlb-confirmation-${payload.investor_no}.pdf`);
  } catch (error) {
    return fail(res, error, 'Could not generate this confirmation.');
  }
}

export async function getVlbPayoutReceiptPdf(req: AuthRequest, res: Response) {
  try {
    const id = routeId(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Payout not found.', 404);
    const payload = await payoutReceiptPayload(id, userId(req));
    const pdf = await pdfService.generateVlbPayoutReceiptPDF(payload);
    return sendPdf(res, pdf, `${payload.receipt_no}.pdf`);
  } catch (error) {
    return fail(res, error, 'Could not generate this receipt.');
  }
}

export async function patchVlbPayout(req: AuthRequest, res: Response) {
  try {
    const parsed = payoutSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const data = await updateInvestorPayout(req, userId(req), parsed.data);
    return successResponse(res, data, 'Payout details saved.');
  } catch (error) {
    return fail(res, error, 'Could not update payout details.');
  }
}
