import { Router } from 'express';
import { getPublicFeatures, patchAdminFeatures } from '../controllers/features.controller';
import { requireSuperadmin } from '../middleware/auth.middleware';

const router = Router();

router.get('/', requireSuperadmin, getPublicFeatures);
router.patch('/', requireSuperadmin, patchAdminFeatures);

export default router;
