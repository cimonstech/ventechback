import { Router } from 'express';
import { requirePermission, requireSuperadmin } from '../middleware/auth.middleware';
import {
  addNote,
  assignTicket,
  changeStatus,
  cleanupUploads,
  createIssueType,
  getTicket,
  getTicketReceipt,
  listAssignees,
  listIssueTypesAdmin,
  listTickets,
  recordTicketPayment,
  replyToTicket,
  ticketSummary,
  updateIssueType,
  updateTicket,
} from '../controllers/adminTickets.controller';

const router = Router();
const view = requirePermission('tickets', 'view');
const edit = requirePermission('tickets', 'edit');

router.get('/', view, listTickets);
router.get('/summary', view, ticketSummary);
router.get('/assignees', view, listAssignees);
router.get('/issue-types', view, listIssueTypesAdmin);
router.post('/issue-types', edit, createIssueType);
router.put('/issue-types/:id', edit, updateIssueType);
router.post('/maintenance/cleanup-uploads', requireSuperadmin, cleanupUploads);
router.get('/:id/receipt', view, getTicketReceipt);
router.get('/:id', view, getTicket);
router.post('/:id/status', edit, changeStatus);
router.post('/:id/reply', edit, replyToTicket);
router.post('/:id/note', edit, addNote);
router.post('/:id/assign', edit, assignTicket);
router.post('/:id/payment', edit, recordTicketPayment);
router.patch('/:id', edit, updateTicket);

export default router;
