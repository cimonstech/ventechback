import { Router } from 'express';
import { postRefClick } from '../controllers/affiliates.controller';
import { refClickRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

router.post('/click', refClickRateLimiter, postRefClick);

export default router;
