import { Router, Request, Response } from 'express';
import { uploadSingle, uploadMultiple } from '../middleware/upload.middleware';
import { uploadToR2, uploadMultipleToR2, deleteFromR2, listR2Files } from '../services/r2.service';

const router = Router();

/**
 * POST /api/upload (catch-all for backward compatibility)
 * POST /api/upload/single
 * Upload a single image
 */
router.post('/', uploadSingle, async (req: Request, res: Response) => {
  // This handles /api/upload requests
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    // Get file from either 'file' or 'image' field
    const file = files?.['file']?.[0] || files?.['image']?.[0];
    
    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file provided',
      });
    }

    // Get folder from query params or body (default: 'uploads')
    const folder = (req.query.folder as string) || (req.body.folder as string) || 'uploads';

    // Upload to R2
    const result = await uploadToR2(file, folder);

    if (result.success) {
      return res.status(200).json({
        success: true,
        url: result.url,
        message: 'File uploaded successfully',
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload file',
    });
  }
});

router.post('/single', uploadSingle, async (req: Request, res: Response) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    // Get file from either 'file' or 'image' field
    const file = files?.['file']?.[0] || files?.['image']?.[0];
    
    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file provided',
      });
    }

    // Get folder from query params (default: 'uploads')
    const folder = (req.query.folder as string) || 'uploads';

    // Upload to R2
    const result = await uploadToR2(file, folder);

    if (result.success) {
      return res.status(200).json({
        success: true,
        url: result.url,
        message: 'File uploaded successfully',
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload file',
    });
  }
});

/**
 * POST /api/upload/multiple
 * Upload multiple images
 */
router.post('/multiple', uploadMultiple, async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files provided',
      });
    }

    // Get folder from query params (default: 'uploads')
    const folder = (req.query.folder as string) || 'uploads';

    // Upload to R2
    const result = await uploadMultipleToR2(files, folder);

    if (result.success) {
      return res.status(200).json({
        success: true,
        urls: result.urls,
        count: result.urls?.length,
        message: `${result.urls?.length} file(s) uploaded successfully`,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload files',
    });
  }
});

/**
 * GET /api/upload/list
 * List all files in R2 (optionally filtered by folder)
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const folder = req.query.folder as string | undefined;
    const maxKeys = parseInt(req.query.maxKeys as string) || 1000;

    const result = await listR2Files(folder, maxKeys);

    if (result.success) {
      return res.status(200).json({
        success: true,
        files: result.files,
        count: result.files?.length || 0,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('List files error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to list files',
    });
  }
});

/**
 * DELETE /api/upload
 * Delete an image from R2
 */
router.delete('/', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'File URL is required',
      });
    }

    const result = await deleteFromR2(url);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'File deleted successfully',
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('Delete error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete file',
    });
  }
});

export default router;



