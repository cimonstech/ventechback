import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  VlbError,
  listPublicPlans,
  submitApplication,
} from '../services/vlb.service';
import { publicAgreementTemplateLink, publicDocsLinks } from '../services/vlbInvestor.service';
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
    return errorResponse(res, error.message, error.statusCode, error.errors, error.code);
  }
  console.error(fallback, error);
  return errorResponse(res, fallback, 500);
}

function uploadedFiles(req: AuthRequest): Array<{ buffer: Buffer; size: number; originalname?: string }> {
  const files = (req as AuthRequest & { files?: Express.Multer.File[] }).files;
  if (!Array.isArray(files)) return [];
  return files.map((file) => ({
    buffer: file.buffer,
    size: file.size,
    originalname: file.originalname,
  }));
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
      files: uploadedFiles(req),
    }, req);
    return successResponse(
      res,
      {
        id: application.id,
        upload_token: application.upload_token,
        has_signed_agreement: application.has_signed_agreement,
      },
      'Application received.',
      201
    );
  } catch (error) {
    return fail(res, error, 'Could not save this application.');
  }
}

export async function getAgreementUpload(req: AuthRequest, res: Response) {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token) return errorResponse(res, 'This upload link is not valid.', 404, null, 'not_found');
    const { getPublicUploadPage } = await import('../services/vlbApplicationFiles.service');
    const data = await getPublicUploadPage(token);
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load this upload link.');
  }
}

export async function postAgreementUpload(req: AuthRequest, res: Response) {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : typeof req.query.token === 'string' ? req.query.token : '';
    if (!token) return errorResponse(res, 'This upload link is not valid.', 404, null, 'not_found');
    const files = uploadedFiles(req);
    if (files.length === 0) return errorResponse(res, 'Choose a file.', 400, { files: 'Choose a file.' }, 'validation');
    const { uploadWithToken } = await import('../services/vlbApplicationFiles.service');
    const data = await uploadWithToken(req, token, files);
    return successResponse(res, data, data.message);
  } catch (error) {
    return fail(res, error, 'Could not store this file.');
  }
}

export async function getPublicAgreementTemplate(_req: AuthRequest, res: Response) {
  try {
    const data = await publicAgreementTemplateLink();
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load the agreement template.');
  }
}

export async function getPublicDocs(_req: AuthRequest, res: Response) {
  try {
    const data = await publicDocsLinks();
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load public documents.');
  }
}
