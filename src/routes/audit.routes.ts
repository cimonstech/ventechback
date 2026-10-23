import { Router } from 'express';
import { listAuditLog } from '../controllers/audit.controller';
import { requireSuperadmin } from '../middleware/auth.middleware';

const router = Router();

router.get('/', requireSuperadmin, listAuditLog);

export default router;
