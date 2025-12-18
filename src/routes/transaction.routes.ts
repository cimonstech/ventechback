import express from 'express';
import { TransactionController } from '../controllers/transaction.controller';

const router = express.Router();
const transactionController = new TransactionController();

// Get all transactions (admin)
router.get('/', transactionController.getAllTransactions);

// Get transaction by ID
router.get('/:id', transactionController.getTransactionById);

// Refund a transaction
router.post('/:id/refund', transactionController.refundTransaction);

export default router;

