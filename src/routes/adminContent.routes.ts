import { Router } from 'express';
import { requirePermission } from '../middleware/auth.middleware';
import {
  createArticle,
  createFaq,
  createFaqCategory,
  deleteArticle,
  deleteFaq,
  deleteFaqCategory,
  getArticle,
  getPage,
  listArticles,
  listFaqCategories,
  listFaqs,
  listPages,
  publishArticle,
  reorderFaqCategories,
  reorderFaqs,
  unpublishArticle,
  updateArticle,
  updateFaq,
  updateFaqCategory,
  updatePage,
} from '../controllers/adminContent.controller';

const router = Router();
const view = requirePermission('content', 'view');
const edit = requirePermission('content', 'edit');

router.get('/articles', view, listArticles);
router.post('/articles', edit, createArticle);
router.get('/articles/:id', view, getArticle);
router.put('/articles/:id', edit, updateArticle);
router.delete('/articles/:id', edit, deleteArticle);
router.post('/articles/:id/publish', edit, publishArticle);
router.post('/articles/:id/unpublish', edit, unpublishArticle);

router.get('/faq-categories', view, listFaqCategories);
router.post('/faq-categories', edit, createFaqCategory);
router.put('/faq-categories/reorder', edit, reorderFaqCategories);
router.put('/faq-categories/:id', edit, updateFaqCategory);
router.delete('/faq-categories/:id', edit, deleteFaqCategory);

router.get('/faqs', view, listFaqs);
router.post('/faqs', edit, createFaq);
router.put('/faqs/reorder', edit, reorderFaqs);
router.put('/faqs/:id', edit, updateFaq);
router.delete('/faqs/:id', edit, deleteFaq);

router.get('/pages', view, listPages);
router.get('/pages/:slug', view, getPage);
router.put('/pages/:slug', edit, updatePage);

export default router;
