import { NextFunction, Response, Router } from 'express';
import {
  adminApprove,
  adminApproveCommission,
  adminExport,
  adminFeeRefunded,
  adminGetAffiliate,
  adminGetSettings,
  adminListAffiliates,
  adminListCommissions,
  adminListWithdrawals,
  adminMetrics,
  adminPutSettings,
  adminReactivate,
  adminReject,
  adminReverseCommission,
  adminSuspend,
  adminWithdrawalStatus,
} from '../controllers/adminAffiliates.controller';
import {
  authenticate,
  AuthRequest,
  requireAnyPermission,
  requirePermission,
  staffHasModuleAccess,
} from '../middleware/auth.middleware';
import { errorResponse } from '../utils/responseHandlers';

const router = Router();
const view = requirePermission('affiliates', 'view');
const edit = requirePermission('affiliates', 'edit');

const money = [
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return errorResponse(res, 'Unauthorized', 401);
    if (req.user.role === 'admin' || req.user.role === 'superadmin') return next();
    if (req.user.role !== 'staff') return errorResponse(res, 'Forbidden - Permission required', 403);
    try {
      const affiliates = await staffHasModuleAccess(req, 'affiliates', 'edit');
      const financeEdit = await staffHasModuleAccess(req, 'finance', 'edit');
      if (!affiliates || !financeEdit) return errorResponse(res, 'Forbidden - Permission required', 403);
      return next();
    } catch (error) {
      console.error('Permission check error:', error);
      return errorResponse(res, 'Failed to check permissions', 500);
    }
  },
];

const withdrawalStatusPerms = [
  ...edit,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.body?.to !== 'paid') return next();
    if (req.user?.role === 'admin' || req.user?.role === 'superadmin') return next();
    try {
      const allowed = await staffHasModuleAccess(req, 'finance', 'edit');
      if (!allowed) return errorResponse(res, 'Forbidden - Permission required', 403);
      return next();
    } catch (error) {
      console.error('Permission check error:', error);
      return errorResponse(res, 'Failed to check permissions', 500);
    }
  },
];

router.get('/settings', requireAnyPermission(['affiliates', 'finance'], 'view'), adminGetSettings);
router.put('/settings', requirePermission('finance', 'edit'), adminPutSettings);
router.get('/metrics', view, adminMetrics);
router.get('/export/:kind', view, adminExport);
router.get('/commissions', view, adminListCommissions);
router.post('/commissions/:id/approve', edit, adminApproveCommission);
router.post('/commissions/:id/reverse', edit, adminReverseCommission);
router.get('/withdrawals', view, adminListWithdrawals);
router.post('/withdrawals/:id/status', withdrawalStatusPerms, adminWithdrawalStatus);
router.get('/', view, adminListAffiliates);
router.get('/:id', view, adminGetAffiliate);
router.post('/:id/approve', edit, adminApprove);
router.post('/:id/reject', edit, adminReject);
router.post('/:id/fee-refunded', money, adminFeeRefunded);
router.post('/:id/suspend', edit, adminSuspend);
router.post('/:id/reactivate', edit, adminReactivate);

export default router;
