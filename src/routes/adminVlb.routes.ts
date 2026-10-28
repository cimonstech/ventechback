import { NextFunction, Response, Router } from 'express';
import multer from 'multer';
import {
  adminActivateApplication,
  adminCreatePlan,
  adminDeleteDocument,
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
  adminRenewInvestment,
  adminScholarFundReport,
  adminSettlementQueue,
  adminSettleInvestment,
  adminUpdatePlan,
  adminUploadAgreementTemplate,
  adminUploadDocument,
} from '../controllers/adminVlb.controller';
import {
  authenticate,
  AuthRequest,
  requirePermission,
  requireSuperadmin,
  staffHasModuleAccess,
} from '../middleware/auth.middleware';
import { requireVlbV3Enabled } from '../middleware/featureFlags.middleware';
import { uploadRateLimiter } from '../middleware/rateLimit.middleware';
import { errorResponse } from '../utils/responseHandlers';

const router = Router();
const view = requirePermission('vlb', 'view');
const edit = requirePermission('vlb', 'edit');
const financeEdit = requirePermission('finance', 'edit');

const money = [
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return errorResponse(res, 'Unauthorized', 401);
    if (req.user.role === 'admin' || req.user.role === 'superadmin') return next();
    if (req.user.role !== 'staff') return errorResponse(res, 'Forbidden - Permission required', 403);
    try {
      const vlb = await staffHasModuleAccess(req, 'vlb', 'edit');
      const finance = await staffHasModuleAccess(req, 'finance', 'edit');
      if (!vlb || !finance) return errorResponse(res, 'Forbidden - Permission required', 403);
      return next();
    } catch (error) {
      console.error('Permission check error:', error);
      return errorResponse(res, 'Failed to check permissions', 500);
    }
  },
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
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

router.get('/plans', view, adminListPlans);
router.post('/plans', edit, adminCreatePlan);
router.put('/plans/:id', edit, adminUpdatePlan);

router.get('/applications', view, adminListApplications);
router.get('/applications/:id', view, adminGetApplication);
router.patch('/applications/:id', edit, adminPatchApplication);
router.post('/applications/:id/activate', money, requireVlbV3Enabled, adminActivateApplication);

router.get('/investors', view, adminListInvestors);
router.get('/investors/:id', view, adminGetInvestor);
router.patch('/investors/:id/payout', financeEdit, adminPatchInvestorPayout);
router.post('/investors/:id/documents', edit, uploadRateLimiter, acceptDocument, adminUploadDocument);

router.get('/investments', view, adminListInvestments);
router.get('/investments/:id/confirmation.pdf', view, adminInvestmentConfirmationPdf);
router.get('/investments/:id/statement.pdf', view, adminInvestmentStatementPdf);
router.get('/investments/:id', view, adminGetInvestment);
router.post('/investments/:id/settle', money, adminSettleInvestment);
router.post('/investments/:id/renew', money, adminRenewInvestment);
router.post('/investments/:id/stars', edit, adminRecordStars);
router.post('/investments/:id/referral-bonus', money, adminReferralBonus);

router.get('/preview-schedule', view, adminPreviewSchedule);
router.get('/payouts', view, adminListPayouts);
router.get('/payouts/:id/receipt.pdf', view, adminPayoutReceiptPdf);
router.post('/payouts/:id/mark-paid', money, adminMarkPayoutPaid);

router.get('/settlement', view, adminSettlementQueue);

router.get('/upgrade-requests', view, adminListUpgrades);
router.patch('/upgrade-requests/:id', edit, adminPatchUpgrade);

router.get('/agreement-template', view, adminGetAgreementTemplate);
router.post('/agreement-template', edit, uploadRateLimiter, acceptDocument, adminUploadAgreementTemplate);
router.get('/documents/:id', view, adminGetDocument);
router.delete('/documents/:id', requireSuperadmin, adminDeleteDocument);

router.get('/reports/scholar-fund', view, adminScholarFundReport);
router.get('/reports/payouts', view, adminPayoutsReport);

export default router;
