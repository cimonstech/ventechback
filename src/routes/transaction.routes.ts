import express from 'express';
import { TransactionController } from '../controllers/transaction.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = express.Router();
const transactionController = new TransactionController();

// Get all transactions (finance view)
router.get('/', requirePermission('finance', 'view'), transactionController.getAllTransactions);

// Get transaction by ID
router.get('/:id', requirePermission('finance', 'view'), transactionController.getTransactionById);

// Refund a transaction
router.post('/:id/refund', requirePermission('finance', 'edit'), transactionController.refundTransaction);

export default router;
