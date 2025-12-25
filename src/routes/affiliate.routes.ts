import express from 'express';
import { affiliateController } from '../controllers/affiliate.controller';

const router = express.Router();

// Affiliate application submission
router.post('/', affiliateController.submitAffiliateApplication);

export default router;

