// src/routes/affiliate.routes.ts

import express from 'express';
import { affiliateController } from '../controllers/affiliate.controller';
import { authenticate, requireAffiliate } from '../middleware/auth.middleware';

const router = express.Router();

// Public endpoint - affiliate application submission
router.post('/', affiliateController.submitAffiliateApplication.bind(affiliateController));

// Protected routes - require authentication and active affiliate status
router.use(authenticate, requireAffiliate);

// Add route debugging middleware
router.use((req, res, next) => {
  console.log(`🔍 AFFILIATE ROUTE: ${req.method} ${req.originalUrl}`);
  next();
});

// Test endpoint to verify routes are working
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Affiliate routes are working',
    endpoints: {
      links: 'GET /api/affiliate/links',
      earnings: 'GET /api/affiliate/earnings',
      earningsSummary: 'GET /api/affiliate/earnings/summary',
      generateLink: 'POST /api/affiliate/links/generate'
    }
  });
});

// Dashboard routes
router.get(
  '/dashboard/stats',
  affiliateController.getDashboardStats.bind(affiliateController)
);
router.get(
  '/dashboard/chart-data',
  affiliateController.getChartData.bind(affiliateController)
);
router.get(
  '/dashboard/recent-earnings',
  affiliateController.getRecentEarnings.bind(affiliateController)
);

// Alias routes for compatibility (some frontends may call these)
router.get('/stats', affiliateController.getDashboardStats.bind(affiliateController));
router.get('/stats/chart', affiliateController.getChartData.bind(affiliateController));

// Referral links routes
router.get('/links', affiliateController.getLinks.bind(affiliateController));
router.get('/links/product', affiliateController.getProductLinks.bind(affiliateController));
router.post('/links/generate', affiliateController.generateLink.bind(affiliateController));
router.post('/links', affiliateController.createLink.bind(affiliateController));
router.get('/links/:id/stats', affiliateController.getLinkStats.bind(affiliateController));
router.put('/links/:id', affiliateController.updateLink.bind(affiliateController));
router.delete('/links/:id', affiliateController.deleteLink.bind(affiliateController));

// Earnings routes
router.get('/earnings', affiliateController.getEarnings.bind(affiliateController));
router.get('/earnings/summary', affiliateController.getEarningsSummary.bind(affiliateController));
router.get('/earnings/monthly', affiliateController.getMonthlyEarnings.bind(affiliateController));
router.get('/earnings/by-tier', affiliateController.getEarningsByTier.bind(affiliateController));
router.get('/earnings/export', affiliateController.exportEarnings.bind(affiliateController));

// Payouts routes
router.get('/payouts', affiliateController.getPayouts.bind(affiliateController));
router.get('/payouts/summary', affiliateController.getPayoutsSummary.bind(affiliateController));
router.post('/payouts/request', affiliateController.requestPayout.bind(affiliateController));
router.post('/payouts/:id/cancel', affiliateController.cancelPayout.bind(affiliateController));
router.get('/payouts/:payoutId/verify', affiliateController.verifyPayoutStatus.bind(affiliateController));
router.post('/payouts/:payoutId/retry', affiliateController.retryFailedPayout.bind(affiliateController));

// Payment methods routes
router.get(
  '/payment-methods',
  affiliateController.getPaymentMethods.bind(affiliateController)
);
router.post(
  '/payment-methods',
  affiliateController.addPaymentMethod.bind(affiliateController)
);
router.delete(
  '/payment-methods/:id',
  affiliateController.deletePaymentMethod.bind(affiliateController)
);
router.post(
  '/payment-methods/:id/setDefault',
  affiliateController.setDefaultPaymentMethod.bind(affiliateController)
);

// Products route
router.get('/products', affiliateController.getProducts.bind(affiliateController));

// Campaigns routes
router.get('/campaigns', affiliateController.getCampaigns.bind(affiliateController));
router.get('/campaigns/:id', affiliateController.getCampaign.bind(affiliateController));
router.get('/campaigns/:id/stats', affiliateController.getCampaignStats.bind(affiliateController));

// Notifications routes
router.get('/notifications', affiliateController.getNotifications.bind(affiliateController));
router.get('/notifications/unread-count', affiliateController.getUnreadNotificationCount.bind(affiliateController));
router.put('/notifications/:id/read', affiliateController.markNotificationAsRead.bind(affiliateController));

// Settings routes
router.get('/settings', affiliateController.getAffiliateSettings.bind(affiliateController));
router.put('/settings', affiliateController.updateAffiliateSettings.bind(affiliateController));

// User profile routes (different base path for user endpoints)
// These would typically be under /api/user but adding here for affiliate context
router.get('/user/profile', affiliateController.getUserProfile.bind(affiliateController));
router.put('/user/profile', affiliateController.updateUserProfile.bind(affiliateController));
router.get('/user/tier', affiliateController.getUserAffiliateTier.bind(affiliateController));

// Admin payout processing routes (should be protected by admin middleware in production)
router.post(
  '/admin/payouts/process',
  affiliateController.processPendingPayouts.bind(affiliateController)
);

export default router;