import { Router } from 'express';
import { getPublicAgreementTemplate, getPublicPlans, postApplication } from '../controllers/vlb.controller';
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

router.get('/plans', getPublicPlans);
router.get('/agreement-template', getPublicAgreementTemplate);
router.post('/applications', contactRateLimiter, optionalAuth, requireVlbV3Enabled, postApplication);

router.get('/me', investor, getVlbMe);
router.get('/me/documents', investor, getVlbMyDocuments);
router.get('/me/documents/:id', investor, getVlbMyDocument);
router.patch('/me/payout', investor, patchVlbPayout);
router.post('/me/upgrade-requests', investor, postVlbUpgradeRequest);
router.get('/me/investments/:id/statement.pdf', investor, getVlbStatementPdf);
router.get('/me/investments/:id/confirmation.pdf', investor, getVlbConfirmationPdf);
router.get('/me/payouts/:id/receipt.pdf', investor, getVlbPayoutReceiptPdf);
router.post('/me/investments/:id/renewal', investor, postVlbRenewal);
router.get('/me/investments/:id', investor, getVlbMyInvestment);

export default router;
