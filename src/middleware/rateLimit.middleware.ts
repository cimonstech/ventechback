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

  return `ip:${req.ip || 'unknown'}`;
};

const retryAfterSeconds = (req: Request): number => {
  const resetTime = (req as any).rateLimit?.resetTime;
  if (!(resetTime instanceof Date)) {
    return 1;
  }
  return Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
};

// Standard rate limit handler
const standardHandler = (req: Request, res: Response) => {
  const identifier = getIdentifier(req);
  console.warn(`Rate limit exceeded for ${identifier} on ${req.path}`);

  const seconds = retryAfterSeconds(req);
  res.setHeader('Retry-After', String(seconds));
  res.status(429).json({
    success: false,
    message: 'Too many requests. Please try again in a moment.',
    retryAfterSeconds: seconds,
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

/**
 * Device claim codes
 * - Runs after authenticate so the key is the user id
 * - 5 requests per hour per user
 */
export const portalEventRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.DISABLE_RATE_LIMIT === 'true' ? 1000000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: (req: Request) => `ip:${req.ip || 'unknown'}`,
});

export const deviceClaimRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.DISABLE_RATE_LIMIT === 'true' ? 1000000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: getIdentifier,
});

/**
 * Service ticket creation
 * - Runs after authenticate so the key is the user id
 * - 5 tickets per user per day
 */
export const ticketCreateRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: process.env.DISABLE_RATE_LIMIT === 'true' ? 1000000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const identifier = getIdentifier(req);
    console.warn(`Rate limit exceeded for ${identifier} on ${req.path}`);
    const seconds = retryAfterSeconds(req);
    res.setHeader('Retry-After', String(seconds));
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again in a moment.',
      retryAfterSeconds: seconds,
    });
  },
  keyGenerator: getIdentifier,
});

/**
 * Public referral click tracking
 * - 40 requests per minute per IP
 */
export const refClickRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.DISABLE_RATE_LIMIT === 'true' ? 1000000 : 40,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: (req: Request) => {
    return `ip:${req.ip || 'unknown'}`;
  },
});

