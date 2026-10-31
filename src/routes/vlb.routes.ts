import { Router } from 'express';
import {
  getAgreementUpload,
  getPublicAgreementTemplate,
  getPublicDocs,
  getPublicPlans,
  postAgreementUpload,
  postApplication,
} from '../controllers/vlb.controller';
import {
  getVlbConfirmationPdf,
  getVlbMe,
  getVlbMyDocument,
  getVlbMyDocuments,
  getVlbMyInvestment,
  getVlbPayoutReceiptPdf,
  getVlbStatementPdf,
  patchVlbPayout,
  postVlbRenewal,
  postVlbUpgradeRequest,
} from '../controllers/vlbMe.controller';
import { optionalAuth, requireProgramRole } from '../middleware/auth.middleware';
import { requireVlbV3Enabled } from '../middleware/featureFlags.middleware';
import { agreementUploadRateLimiter, contactRateLimiter } from '../middleware/rateLimit.middleware';
import multer from 'multer';
import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { errorResponse } from '../utils/responseHandlers';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
});

function acceptAgreementFiles(req: AuthRequest, res: Response, next: NextFunction) {
  upload.array('files', 10)(req, res, (err: unknown) => {
    if (!err) return next();
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'Each file must be 10 MB or smaller.', 400, { files: 'Each file must be 10 MB or smaller.' }, 'validation');
    if (code === 'LIMIT_FILE_COUNT') return errorResponse(res, 'Upload up to 10 photos.', 400, { files: 'Upload up to 10 photos.' }, 'validation');
    return errorResponse(res, 'Could not upload this file', 400);
  });
}

const router = Router();
const investor = requireProgramRole('investor');

const dashboard = [investor, requireVlbV3Enabled];

router.get('/plans', getPublicPlans);
router.get('/public-docs', getPublicDocs);
router.get('/agreement-template', getPublicAgreementTemplate);
router.post('/applications', contactRateLimiter, optionalAuth, acceptAgreementFiles, postApplication);
router.get('/agreement-upload', getAgreementUpload);
router.post('/agreement-upload', agreementUploadRateLimiter, acceptAgreementFiles, postAgreementUpload);

router.get('/me', ...dashboard, getVlbMe);
router.get('/me/documents', ...dashboard, getVlbMyDocuments);
router.get('/me/documents/:id', ...dashboard, getVlbMyDocument);
router.patch('/me/payout', ...dashboard, patchVlbPayout);
router.post('/me/upgrade-requests', ...dashboard, postVlbUpgradeRequest);
router.get('/me/investments/:id/statement.pdf', ...dashboard, getVlbStatementPdf);
router.get('/me/investments/:id/confirmation.pdf', ...dashboard, getVlbConfirmationPdf);
router.get('/me/payouts/:id/receipt.pdf', ...dashboard, getVlbPayoutReceiptPdf);
router.post('/me/investments/:id/renewal', ...dashboard, postVlbRenewal);
router.get('/me/investments/:id', ...dashboard, getVlbMyInvestment);

export default router;
