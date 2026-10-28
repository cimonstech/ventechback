import { Router } from 'express';
import { postRefClick } from '../controllers/affiliates.controller';
import { requireAffiliatesEnabled } from '../middleware/featureFlags.middleware';
import { refClickRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

router.post('/click', refClickRateLimiter, requireAffiliatesEnabled, postRefClick);

export default router;
