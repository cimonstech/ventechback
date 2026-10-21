import express from 'express';
import { PaymentController } from '../controllers/payment.controller';
import { paymentRateLimiter } from '../middleware/rateLimit.middleware';
import { optionalAuth } from '../middleware/auth.middleware';

const router = express.Router();
const paymentController = new PaymentController();

// Initialize Paystack transaction
router.post('/initialize', paymentRateLimiter, optionalAuth, paymentController.initializeTransaction);

// Verify Paystack transaction
router.post('/verify', paymentRateLimiter, paymentController.verifyTransaction);

// Paystack webhook (for automatic order creation)
router.post('/webhook', paymentController.handleWebhook);

export default router;

