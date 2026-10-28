import { Router } from 'express';
import { requireAnyPermission } from '../middleware/auth.middleware';
import { getOrderDeviceStatus } from '../controllers/adminDevices.controller';

const router = Router();

router.get(
  '/:id/device-status',
  requireAnyPermission(['orders', 'devices'], 'view'),
  getOrderDeviceStatus
);

export default router;
