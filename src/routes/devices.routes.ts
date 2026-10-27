import { Router } from 'express';
import { authenticate, optionalAuth } from '../middleware/auth.middleware';
import { deviceClaimRateLimiter } from '../middleware/rateLimit.middleware';
import { claimDevice, listMine, publicDevice, verifyClaim } from '../controllers/devices.controller';

const router = Router();

router.get('/mine', authenticate, listMine);
router.get('/public/:token', optionalAuth, publicDevice);
router.post('/:token/claim/verify', authenticate, verifyClaim);
router.post('/:token/claim', authenticate, deviceClaimRateLimiter, claimDevice);

export default router;
