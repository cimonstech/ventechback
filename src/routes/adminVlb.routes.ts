import { NextFunction, Response, Router } from 'express';
import multer from 'multer';
import {
  adminActivateApplication,
  adminCreatePlan,
  adminDeleteDocument,
  adminDeletePublicDoc,
  adminGetAgreementTemplate,
  adminGetApplication,
  adminGetDocument,
  adminGetInvestment,
  adminGetInvestor,
  adminInvestmentConfirmationPdf,
  adminInvestmentStatementPdf,
  adminListApplications,
  adminListInvestments,
  adminListInvestors,
  adminListPayouts,
  adminListPlans,
  adminListPublicDocs,
  adminListUpgrades,
  adminMarkPayoutPaid,
  adminPatchApplication,
  adminPatchInvestorPayout,
  adminPatchUpgrade,
  adminPayoutReceiptPdf,
  adminPayoutsReport,
  adminPreviewSchedule,
  adminRecordStars,
  adminReferralBonus,
  adminRemoveApplicationFile,
  adminRenewInvestment,
  adminScholarFundReport,
  adminSendAgreementLink,
  adminSettlementQueue,
  adminSettleInvestment,
  adminUpdatePlan,
  adminUploadAgreementTemplate,
  adminUploadApplicationFiles,
  adminUploadDocument,
  adminUploadPublicDoc,
  adminGetApplicationFile,
} from '../controllers/adminVlb.controller';
import {
  AuthRequest,
  requirePermission,
  requireSuperadmin,
  requireVlbMoney,
} from '../middleware/auth.middleware';
import { requireVlbV3Enabled } from '../middleware/featureFlags.middleware';
import { uploadRateLimiter } from '../middleware/rateLimit.middleware';
import { errorResponse } from '../utils/responseHandlers';

const router = Router();
const view = requirePermission('vlb', 'view');
const edit = requirePermission('vlb', 'edit');
const financeEdit = requirePermission('finance', 'edit');
const money = requireVlbMoney;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const agreementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
});

function acceptDocument(req: AuthRequest, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    console.error('vlb document upload', err);
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'This file is too large.', 400);
    return errorResponse(res, 'Could not upload this file', 400);
  });
}

function acceptAgreementFiles(req: AuthRequest, res: Response, next: NextFunction) {
  agreementUpload.array('files', 10)(req, res, (err: unknown) => {
    if (!err) return next();
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'Each file must be 10 MB or smaller.', 400);
    if (code === 'LIMIT_FILE_COUNT') return errorResponse(res, 'Upload up to 10 photos.', 400);
    return errorResponse(res, 'Could not upload this file', 400);
  });
}

router.get('/plans', view, adminListPlans);
router.post('/plans', edit, adminCreatePlan);
router.put('/plans/:id', edit, adminUpdatePlan);

router.get('/applications', view, adminListApplications);
router.get('/applications/:id', view, adminGetApplication);
router.patch('/applications/:id', edit, adminPatchApplication);
router.post('/applications/:id/activate', money, requireVlbV3Enabled, adminActivateApplication);
router.post('/applications/:id/files', edit, uploadRateLimiter, acceptAgreementFiles, adminUploadApplicationFiles);
router.get('/applications/:id/files/:fileId', view, adminGetApplicationFile);
router.delete('/applications/:id/files/:fileId', edit, adminRemoveApplicationFile);
router.post('/applications/:id/send-upload-link', edit, uploadRateLimiter, adminSendAgreementLink);

router.get('/investors', view, adminListInvestors);
router.get('/investors/:id', view, adminGetInvestor);
router.patch('/investors/:id/payout', financeEdit, adminPatchInvestorPayout);
router.post('/investors/:id/documents', edit, uploadRateLimiter, acceptDocument, adminUploadDocument);

router.get('/investments', view, adminListInvestments);
router.get('/investments/:id/confirmation.pdf', view, adminInvestmentConfirmationPdf);
router.get('/investments/:id/statement.pdf', view, adminInvestmentStatementPdf);
router.get('/investments/:id', view, adminGetInvestment);
router.post('/investments/:id/settle', money, adminSettleInvestment);
router.post('/investments/:id/renew', money, requireVlbV3Enabled, adminRenewInvestment);
router.post('/investments/:id/stars', edit, adminRecordStars);
router.post('/investments/:id/referral-bonus', money, adminReferralBonus);

router.get('/preview-schedule', view, adminPreviewSchedule);
router.get('/payouts', view, adminListPayouts);
router.get('/payouts/:id/receipt.pdf', view, adminPayoutReceiptPdf);
router.post('/payouts/:id/mark-paid', money, requireVlbV3Enabled, adminMarkPayoutPaid);

router.get('/settlement', view, adminSettlementQueue);

router.get('/upgrade-requests', view, adminListUpgrades);
router.patch('/upgrade-requests/:id', edit, adminPatchUpgrade);

router.get('/agreement-template', view, adminGetAgreementTemplate);
router.post('/agreement-template', edit, uploadRateLimiter, acceptDocument, adminUploadAgreementTemplate);
router.get('/public-docs', view, adminListPublicDocs);
router.post('/public-docs/:kind', edit, uploadRateLimiter, acceptDocument, adminUploadPublicDoc);
router.delete('/public-docs/:kind', edit, adminDeletePublicDoc);
router.get('/documents/:id', view, adminGetDocument);
router.delete('/documents/:id', requireSuperadmin, adminDeleteDocument);

router.get('/reports/scholar-fund', view, adminScholarFundReport);
router.get('/reports/payouts', view, adminPayoutsReport);

export default router;
