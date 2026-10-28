import { Router } from 'express';
import { requireAnyPermission, requirePermission } from '../middleware/auth.middleware';
import {
  createDevices,
  getDevice,
  getLaptopOsGaps,
  getLaptopWarrantyGaps,
  getPortalStats,
  linkOwner,
  listDevices,
  lookupOrder,
  regenerateToken,
  unlinkOwner,
  updateDevice,
} from '../controllers/adminDevices.controller';

const router = Router();
const view = requirePermission('devices', 'view');
const edit = requirePermission('devices', 'edit');

router.get('/', view, listDevices);
router.get('/order-lookup', view, lookupOrder);
router.get('/portal-stats', view, getPortalStats);
router.get('/laptop-warranty-gaps', requireAnyPermission(['products', 'devices'], 'view'), getLaptopWarrantyGaps);
router.get('/laptop-os-gaps', requireAnyPermission(['products', 'devices'], 'view'), getLaptopOsGaps);
router.post('/', edit, createDevices);
router.post('/:id/regenerate-token', edit, regenerateToken);
router.post('/:id/link-owner', edit, linkOwner);
router.post('/:id/unlink-owner', edit, unlinkOwner);
router.get('/:id', view, getDevice);
router.patch('/:id', edit, updateDevice);

export default router;
