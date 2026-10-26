import multer from 'multer';
import { Request, Response, NextFunction } from 'express';

// Configure multer to store files in memory
const storage = multer.memoryStorage();

const IMAGE_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

const IMAGE_LIMIT = 5 * 1024 * 1024;
const PDF_LIMIT = 10 * 1024 * 1024;

// Images stay at 5 MB. PDFs are accepted here and rejected in the route unless
// the folder is content, where the limit is 10 MB.
const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (IMAGE_MIMES.includes(file.mimetype) || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WEBP, and SVG are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: PDF_LIMIT,
  },
});

export function uploadFolder(req: Request): string {
  const queryFolder = req.query.folder;
  const fromQuery = Array.isArray(queryFolder) ? queryFolder[0] : queryFolder;
  const fromBody = typeof req.body?.folder === 'string' ? req.body.folder : '';
  return (typeof fromQuery === 'string' && fromQuery) || fromBody || 'uploads';
}

export function uploadLimitMessage(file: Express.Multer.File, folder: string): string | null {
  if (file.mimetype === 'application/pdf') {
    if (folder !== 'content') {
      return 'PDF files can only be uploaded to the content folder.';
    }
    if (file.size > PDF_LIMIT) {
      return 'PDF files must be 10 MB or smaller.';
    }
    return null;
  }

  if (file.size > IMAGE_LIMIT) {
    return 'Images must be 5 MB or smaller.';
  }

  return null;
}

// Middleware for single file upload - accepts both 'file' and 'image' field names
export const uploadSingle = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]);

// Middleware for multiple files upload (max 10)
export const uploadMultiple = upload.array('images', 10);



