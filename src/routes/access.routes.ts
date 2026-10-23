import { Router } from 'express';
import { getMyAccess } from '../controllers/access.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/access', authenticate, getMyAccess);

export default router;
