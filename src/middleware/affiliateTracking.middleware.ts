// src/middleware/affiliateTracking.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { affiliateService } from '../services/affiliate.service';

export const trackAffiliateClick = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ref } = req.query;

    if (ref && typeof ref === 'string') {
      // Validate referral code format (basic check)
      if (!ref.startsWith('AFF') || ref.length < 10) {
        console.log(`[AFFILIATE] Invalid referral code format: ${ref}`);
        return next();
      }

      // Track the click with landing page
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';
      const source = typeof req.query.utm_source === 'string' ? req.query.utm_source : 'direct';
      const landingPage = req.originalUrl || req.url;

      console.log(`[AFFILIATE] Referral detected: ${ref} from IP: ${ip} on page: ${landingPage}`);

      await affiliateService.trackClick(ref, ip, userAgent, source, landingPage);

      // Set cookie for 30-day tracking
      res.cookie('affiliate_ref', ref, {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });

      if (source && source !== 'direct') {
        res.cookie('affiliate_source', source, {
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        });
      }

      console.log(`[AFFILIATE] Cookie set for referral: ${ref}`);
    }

    next();
  } catch (error) {
    console.error('[AFFILIATE] Click tracking error:', error);
    next(); // Don't block request on tracking failure
  }
};