import express from 'express';
import { CouponController } from '../controllers/coupon.controller';
import { optionalAuth, requireAdmin } from '../middleware/auth.middleware';

const router = express.Router();
const couponController = new CouponController();

// Public endpoints
router.post('/validate', optionalAuth, couponController.validateCoupon.bind(couponController));

// Admin endpoints
router.get('/', requireAdmin, couponController.getAllCoupons.bind(couponController));
router.get('/:id', requireAdmin, couponController.getCouponById.bind(couponController));
router.post('/', requireAdmin, couponController.createCoupon.bind(couponController));
router.patch('/:id', requireAdmin, couponController.updateCoupon.bind(couponController));
router.delete('/:id', requireAdmin, couponController.deleteCoupon.bind(couponController));

export default router;
