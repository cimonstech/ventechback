import { Router } from 'express';
import { getPublicFeatures } from '../controllers/features.controller';

const router = Router();

router.get('/', getPublicFeatures);

export default router;
