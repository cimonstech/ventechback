import { Router } from 'express';
import { getPublicPlans, postApplication } from '../controllers/vlb.controller';
import {
  getVlbMe,
  getVlbMyDocuments,
  getVlbMyInvestment,
  getVlbStatementPdf,
  patchVlbPayout,
  postVlbRenewal,
  postVlbUpgradeRequest,
} from '../controllers/vlbMe.controller';
import { optionalAuth, requireProgramRole } from '../middleware/auth.middleware';
import { contactRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();
const investor = requireProgramRole('investor');

router.get('/plans', getPublicPlans);
router.post('/applications', contactRateLimiter, optionalAuth, postApplication);

router.get('/me', investor, getVlbMe);
router.get('/me/documents', investor, getVlbMyDocuments);
router.patch('/me/payout', investor, patchVlbPayout);
router.post('/me/upgrade-requests', investor, postVlbUpgradeRequest);
router.get('/me/investments/:id/statement.pdf', investor, getVlbStatementPdf);
router.post('/me/investments/:id/renewal', investor, postVlbRenewal);
router.get('/me/investments/:id', investor, getVlbMyInvestment);

export default router;
