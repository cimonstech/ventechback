import express from 'express';
import { bulkOrderController } from '../controllers/bulkOrder.controller';

const router = express.Router();

// Bulk order request submission
router.post('/', bulkOrderController.submitBulkOrderRequest);

export default router;

