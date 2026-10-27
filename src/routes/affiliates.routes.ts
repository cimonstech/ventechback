import { Router } from 'express';
import { getPublicInfo, postFeeInitialize, postFeeVerify, postRegister } from '../controllers/affiliates.controller';
import {
  getAffiliateLedger,
  getAffiliateMe,
  getAffiliateSales,
  getAffiliateSummary,
  getAffiliateWithdrawals,
  getProductSearch,
  patchPayout,
  patchWithdrawalMode,
  postWithdrawal,
} from '../controllers/affiliateMe.controller';
import { authenticate, requireProgramRole } from '../middleware/auth.middleware';
import { paymentRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();
const affiliate = requireProgramRole('affiliate');

router.get('/public-info', getPublicInfo);
router.post('/register', authenticate, postRegister);
router.post('/fee/initialize', authenticate, paymentRateLimiter, postFeeInitialize);
router.post('/fee/verify', authenticate, paymentRateLimiter, postFeeVerify);

router.get('/me', authenticate, getAffiliateMe);
router.get('/me/summary', affiliate, getAffiliateSummary);
router.get('/me/sales', affiliate, getAffiliateSales);
router.get('/me/ledger', affiliate, getAffiliateLedger);
router.get('/me/withdrawals', affiliate, getAffiliateWithdrawals);
router.patch('/me/payout', affiliate, patchPayout);
router.patch('/me/withdrawal-mode', affiliate, patchWithdrawalMode);
router.post('/me/withdrawals', affiliate, postWithdrawal);
router.get('/products/search', affiliate, getProductSearch);

export default router;
