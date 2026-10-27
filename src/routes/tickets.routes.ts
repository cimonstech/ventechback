import { NextFunction, Response, Router } from 'express';
import multer from 'multer';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { ticketCreateRateLimiter, uploadRateLimiter } from '../middleware/rateLimit.middleware';
import { errorResponse } from '../utils/responseHandlers';
import {
  createTicket,
  createUpload,
  deleteUpload,
  getMine,
  listIssueTypes,
  listMine,
  postMessage,
} from '../controllers/tickets.controller';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

function acceptTicketFile(req: AuthRequest, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    console.error('ticket upload', err);
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'This file is too large.', 400);
    return errorResponse(res, 'Could not upload this file', 400);
  });
}

router.get('/issue-types', listIssueTypes);
router.post('/uploads', authenticate, uploadRateLimiter, acceptTicketFile, createUpload);
router.delete('/uploads/:id', authenticate, deleteUpload);
router.get('/mine', authenticate, listMine);
router.get('/mine/:ticketNo', authenticate, getMine);
router.post('/mine/:ticketNo/messages', authenticate, postMessage);
router.post('/', authenticate, ticketCreateRateLimiter, createTicket);

export default router;
