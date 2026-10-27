import { Router } from 'express';
import { requirePermission } from '../middleware/auth.middleware';
import {
  createDevices,
  getDevice,
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
router.post('/', edit, createDevices);
router.post('/:id/regenerate-token', edit, regenerateToken);
router.post('/:id/link-owner', edit, linkOwner);
router.post('/:id/unlink-owner', edit, unlinkOwner);
router.get('/:id', view, getDevice);
router.patch('/:id', edit, updateDevice);

export default router;
