import { Router } from 'express';
import {
  adminExportCustomers,
  adminGetCustomer,
  adminListCustomers,
} from '../controllers/adminCustomers.controller';
import { requireStaff } from '../middleware/auth.middleware';

const router = Router();

router.get('/', requireStaff, adminListCustomers);
router.get('/export', requireStaff, adminExportCustomers);
router.get('/:id', requireStaff, adminGetCustomer);

export default router;
