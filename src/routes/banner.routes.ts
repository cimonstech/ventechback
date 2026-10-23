import { Router } from 'express';
import {
  getBannersByType,
  getAllBanners,
  createBanner,
  updateBanner,
  deleteBanner,
} from '../controllers/banner.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = Router();

// Admin routes (must come before /:type to avoid route conflict)
router.get('/', requirePermission('content', 'view'), getAllBanners);
router.post('/', requirePermission('content', 'edit'), createBanner);
router.put('/:id', requirePermission('content', 'edit'), updateBanner);
router.delete('/:id', requirePermission('content', 'edit'), deleteBanner);

// Public routes (must come after specific routes)
router.get('/:type', getBannersByType);

export default router;



