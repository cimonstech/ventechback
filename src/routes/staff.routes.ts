import { Router } from 'express';
import { createStaff, demoteStaff, getStaff, listStaff, updateStaff } from '../controllers/staff.controller';
import { requireAdmin } from '../middleware/auth.middleware';

const router = Router();

router.get('/', requireAdmin, listStaff);
router.get('/:id', requireAdmin, getStaff);
router.post('/', requireAdmin, createStaff);
router.patch('/:id', requireAdmin, updateStaff);
router.delete('/:id', requireAdmin, demoteStaff);

export default router;
