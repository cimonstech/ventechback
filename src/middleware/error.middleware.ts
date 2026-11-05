import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    const path = String(req.originalUrl || req.path || '');
    if (path.includes('/api/payments/webhook')) {
      console.error('[webhook-too-large]', req.headers['content-length'] || err.length || '');
    }
    return res.status(413).json({
      success: false,
      message: 'This request is too large.',
    });
  }

  console.error('Error:', req.originalUrl, err);

  const statusCode = err.statusCode || 500;
  const message =
    statusCode === 404
      ? "We couldn't find that."
      : statusCode === 429
        ? 'Too many requests. Wait a moment and try again.'
        : statusCode >= 500
          ? 'Something went wrong. Please try again in a moment.'
          : 'Something went wrong. Please try again.';

  res.status(statusCode).json({
    success: false,
    message,
  });
};

export const notFound = (req: Request, res: Response, next: NextFunction) => {
  res.status(404).json({
    success: false,
    message: "We couldn't find that.",
  });
};
