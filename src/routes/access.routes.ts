import { Router } from 'express';
import { getMyAccess } from '../controllers/access.controller';
import { getMyOverview } from '../controllers/me.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/access', authenticate, getMyAccess);
router.get('/overview', authenticate, getMyOverview);

export default router;
