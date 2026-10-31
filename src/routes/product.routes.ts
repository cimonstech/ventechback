import { Router, Request, Response, NextFunction } from 'express';
import {
  getAllProducts,
  getProductBySlug,
  getFeaturedProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getAllCategories,
  isPreOrderOnlyProductPatch,
} from '../controllers/product.controller';
import {
  authenticate,
  AuthRequest,
  requirePermission,
  staffHasModuleAccess,
} from '../middleware/auth.middleware';
import { errorResponse, forbiddenResponse, unauthorizedResponse } from '../utils/responseHandlers';
import { 
  publicRateLimiter, 
  productDetailsRateLimiter,
  searchRateLimiter 
} from '../middleware/rateLimit.middleware';

const router = Router();

// Middleware to apply search rate limiter if search query is present
const applySearchRateLimit = (req: Request, res: Response, next: NextFunction) => {
  if (req.query.search) {
    return searchRateLimiter(req, res, next);
  } else {
    return publicRateLimiter(req, res, next);
  }
};

// Public routes with rate limiting
router.get('/', applySearchRateLimit, getAllProducts);
router.get('/featured', publicRateLimiter, getFeaturedProducts);
router.get('/categories', publicRateLimiter, getAllCategories);
router.get('/:slug', productDetailsRateLimiter, getProductBySlug);

const requireProductUpdateAccess = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return unauthorizedResponse(res);
  }

  if (req.user.role === 'admin' || req.user.role === 'superadmin') {
    return next();
  }

  if (req.user.role !== 'staff') {
    return forbiddenResponse(res);
  }

  try {
    if (await staffHasModuleAccess(req, 'products', 'edit')) {
      return next();
    }

    if (await staffHasModuleAccess(req, 'orders', 'edit') && isPreOrderOnlyProductPatch(req.body)) {
      return next();
    }

    return forbiddenResponse(res);
  } catch (error) {
    console.error('Permission check error:', error);
    return errorResponse(res, 'Failed to check permissions', 500);
  }
};

// Admin routes
router.post('/', requirePermission('products', 'edit'), createProduct);
router.put('/:id', authenticate, requireProductUpdateAccess, updateProduct);
router.delete('/:id', requirePermission('products', 'edit'), deleteProduct);

export default router;



