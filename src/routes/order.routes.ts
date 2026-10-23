import express from 'express';
import { OrderController } from '../controllers/order.controller';
import { orderRateLimiter } from '../middleware/rateLimit.middleware';
import { optionalAuth, requirePermission } from '../middleware/auth.middleware';

const router = express.Router();
const orderController = new OrderController();

// Track order by number/ID and email (public endpoint)
router.post('/track', orderRateLimiter, orderController.trackOrder.bind(orderController));

// Get all orders (orders view)
router.get('/', requirePermission('orders', 'view'), orderController.getAllOrders.bind(orderController));

// Get order by ID (owner, admin, or guest order by its unguessable ID)
router.get('/:id', optionalAuth, orderController.getOrderById.bind(orderController));

// Update order status
router.patch('/:id/status', requirePermission('orders', 'edit'), orderController.updateOrderStatus.bind(orderController));

// Update payment status
router.patch('/:id/payment-status', requirePermission('orders', 'edit'), orderController.updatePaymentStatus.bind(orderController));

// Cancel order (owner, admin, or guest with matching email)
router.patch('/:id/cancel', optionalAuth, orderController.cancelOrder.bind(orderController));

// Create order (guests allowed; user is taken from the token, never the body)
router.post('/', orderRateLimiter, optionalAuth, orderController.createOrder.bind(orderController));

// Send wishlist reminder
router.post('/wishlist-reminder/:user_id', requirePermission('orders', 'edit'), orderController.sendWishlistReminder.bind(orderController));

// Send cart abandonment reminder
router.post('/cart-abandonment-reminder', requirePermission('orders', 'edit'), orderController.sendCartAbandonmentReminder.bind(orderController));

// Get order items (admin)
router.get('/:id/items', requirePermission('orders', 'view'), orderController.getOrderItems.bind(orderController));

// Download order PDF
router.get('/:id/pdf', requirePermission('orders', 'view'), orderController.downloadOrderPDF.bind(orderController));

export default router;
