import express from 'express';
import { OrderController } from '../controllers/order.controller';

const router = express.Router();
const orderController = new OrderController();

// Track order by number/ID and email (public endpoint)
router.post('/track', orderController.trackOrder.bind(orderController));

// Get all orders (admin only)
router.get('/', orderController.getAllOrders.bind(orderController));

// Get order by ID
router.get('/:id', orderController.getOrderById.bind(orderController));

// Update order status
router.patch('/:id/status', orderController.updateOrderStatus.bind(orderController));

// Update payment status
router.patch('/:id/payment-status', orderController.updatePaymentStatus.bind(orderController));

// Cancel order
router.patch('/:id/cancel', orderController.cancelOrder.bind(orderController));

// Create order
router.post('/', orderController.createOrder.bind(orderController));

// Send wishlist reminder
router.post('/wishlist-reminder/:user_id', orderController.sendWishlistReminder.bind(orderController));

// Send cart abandonment reminder
router.post('/cart-abandonment-reminder', orderController.sendCartAbandonmentReminder.bind(orderController));

// Download order PDF
router.get('/:id/pdf', orderController.downloadOrderPDF.bind(orderController));

export default router;