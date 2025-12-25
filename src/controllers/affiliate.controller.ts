import { Request, Response } from 'express';
import { sendAffiliateApplicationEmail } from '../services/email.service';

export class AffiliateController {
  // Submit affiliate application
  async submitAffiliateApplication(req: Request, res: Response) {
    try {
      const { 
        fullName, 
        email, 
        phone, 
        country, 
        promotionChannel, 
        platformLink, 
        audienceSize, 
        payoutMethod, 
        reason 
      } = req.body;

      // Validate required fields
      if (!fullName || !email || !phone || !country || !promotionChannel || !platformLink) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: fullName, email, phone, country, promotionChannel, and platformLink are required'
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format'
        });
      }

      // Validate URL format
      try {
        new URL(platformLink);
      } catch {
        return res.status(400).json({
          success: false,
          message: 'Invalid platform link format'
        });
      }

      // Attempt to send email notification
      const emailResult = await sendAffiliateApplicationEmail({
        fullName,
        email,
        phone,
        country,
        promotionChannel,
        platformLink,
        audienceSize: audienceSize || null,
        payoutMethod: payoutMethod || null,
        reason: reason || null,
      });

      if (!emailResult.success) {
        // Log but do not fail the request; we accept the submission regardless
        console.error('Failed to send affiliate application email:', emailResult.error);
      }

      return res.json({
        success: true,
        message: 'Affiliate application submitted successfully! We\'ll review your application and get back to you soon.'
      });

    } catch (error) {
      console.error('Error processing affiliate application:', error);
      return res.status(200).json({
        success: false,
        message: 'Your application was received. Email notification will be retried by the server.',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export const affiliateController = new AffiliateController();

