import { Router } from 'express';
import { authenticate, optionalAuth } from '../middleware/auth.middleware';
import { deviceClaimRateLimiter, portalEventRateLimiter } from '../middleware/rateLimit.middleware';
import { claimDevice, linkPendingDevices, listMine, publicDevice, recordPortalEvent, verifyClaim } from '../controllers/devices.controller';

const router = Router();

router.get('/mine', authenticate, listMine);
router.post('/link-pending', authenticate, linkPendingDevices);
router.post('/events', portalEventRateLimiter, recordPortalEvent);
router.get('/public/:token', optionalAuth, publicDevice);
router.post('/:token/claim/verify', authenticate, verifyClaim);
router.post('/:token/claim', authenticate, deviceClaimRateLimiter, claimDevice);

export default router;
