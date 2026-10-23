import { Router } from 'express';
import { createStaff, demoteStaff, listStaff, updateStaff } from '../controllers/staff.controller';
import { requireAdmin } from '../middleware/auth.middleware';

const router = Router();

router.get('/', requireAdmin, listStaff);
router.post('/', requireAdmin, createStaff);
router.patch('/:id', requireAdmin, updateStaff);
router.delete('/:id', requireAdmin, demoteStaff);

export default router;
