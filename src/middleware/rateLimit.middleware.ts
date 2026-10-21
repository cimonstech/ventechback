import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * Rate Limiting Middleware
 * 
 * Different rate limits for different endpoint types:
 * - Public endpoints: Moderate limits
 * - Order/Payment endpoints: Stricter limits
 * - Upload endpoints: Very strict limits
 * - Admin endpoints: Moderate limits
 */

// Helper to get client identifier (IP address or user ID)
const getIdentifier = (req: Request): string => {
  // Try to get user ID if authenticated
  if ((req as any).user?.id) {
    return `user:${(req as any).user.id}`;
  }
  
  // Fall back to IP address
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? (typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded[0])
    : req.ip || req.socket.remoteAddress || 'unknown';
  
  return `ip:${ip}`;
};

// Standard rate limit handler
const standardHandler = (req: Request, res: Response) => {
  const identifier = getIdentifier(req);
  console.warn(`Rate limit exceeded for ${identifier} on ${req.path}`);
  
  res.status(429).json({
    success: false,
    message: 'Too many requests. Please try again later.',
    retryAfter: Math.ceil((req as any).rateLimit.resetTime / 1000),
  });
};

/**
 * Public Endpoints Rate Limiter
 * - Product listings, search, categories
 * - 100 requests per minute per IP (or higher for testing)
 */
export const publicRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.DISABLE_RATE_LIMIT === 'true' 
    ? 1000000 // Effectively disable for testing
    : parseInt(process.env.RATE_LIMIT_PUBLIC || '100', 10), // Configurable via env
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: standardHandler,
  skip: (req: Request) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
});

/**
 * Product Details Rate Limiter
 * - Individual product pages
 * - 60 requests per minute per IP (or higher for testing)
 */
export const productDetailsRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.DISABLE_RATE_LIMIT === 'true'
    ? 1000000
    : parseInt(process.env.RATE_LIMIT_PRODUCT_DETAILS || '60', 10),
  message: 'Too many product detail requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
});

/**
 * Search Rate Limiter
 * - Search functionality
 * - 30 requests per minute per IP (or higher for testing)
 */
export const searchRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.DISABLE_RATE_LIMIT === 'true'
    ? 1000000
    : parseInt(process.env.RATE_LIMIT_SEARCH || '30', 10),
  message: 'Too many search requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
});

/**
 * Order Rate Limiter
 * - Order creation, tracking
 * - 10 requests per minute per user/IP
 */
export const orderRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per window
  message: 'Too many order requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: getIdentifier,
});

/**
 * Payment Rate Limiter
 * - Payment initialization, verification
 * - 5 requests per minute per user/IP
 */
export const paymentRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per window
  message: 'Too many payment requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: getIdentifier,
});

/**
 * Upload Rate Limiter
 * - File uploads
 * - 20 requests per minute per user/IP
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per window
  message: 'Too many upload requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: getIdentifier,
});

/**
 * Contact/Bulk Order Rate Limiter
 * - Contact form, bulk order requests
 * - 5 requests per hour per IP
 */
export const contactRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per hour
  message: 'Too many contact requests. Please wait before submitting again.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
});

