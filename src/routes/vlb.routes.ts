import { Router } from 'express';
import {
  getPublicAgreementTemplate,
  getPublicDocs,
  getPublicPlans,
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
import { contactRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();
const investor = requireProgramRole('investor');

const dashboard = [investor, requireVlbV3Enabled];

router.get('/plans', getPublicPlans);
router.get('/public-docs', getPublicDocs);
router.get('/agreement-template', getPublicAgreementTemplate);
router.post('/applications', contactRateLimiter, optionalAuth, postApplication);

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
