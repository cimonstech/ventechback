import { Router } from 'express';
import { postFeeInitialize, postFeeVerify, postRegister } from '../controllers/affiliates.controller';
import { authenticate } from '../middleware/auth.middleware';
import { paymentRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

router.post('/register', authenticate, postRegister);
router.post('/fee/initialize', authenticate, paymentRateLimiter, postFeeInitialize);
router.post('/fee/verify', authenticate, paymentRateLimiter, postFeeVerify);

export default router;
