import { Router } from 'express';
import {
  articlesForProduct,
  getPublicArticle,
  getPublicPage,
  listPublicArticles,
  listPublicFaqs,
} from '../controllers/content.controller';

const router = Router();

router.get('/faqs', listPublicFaqs);
router.get('/pages/:slug', getPublicPage);
router.get('/articles', listPublicArticles);
router.get('/articles/:slug', getPublicArticle);
router.get('/for-product/:productId', articlesForProduct);

export default router;
