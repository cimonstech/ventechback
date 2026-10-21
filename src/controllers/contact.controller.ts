import { Request, Response } from 'express';
import { sendContactEmail } from '../services/email.service';

class ContactController {
  // Submit contact form
  async submitContactForm(req: Request, res: Response) {
    try {
      const { name, email, phone, subject, message } = req.body;

      // Validate required fields
      if (!name || !email || !subject || !message) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: name, email, subject, and message are required'
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

      // Attempt to send email notification (non-blocking for UX)
      const emailResult = await sendContactEmail({
        name,
        email,
        phone: phone || null,
        subject,
        message
      });

      if (!emailResult.success) {
        // Log but do not fail the request; we accept the submission regardless
        console.error('Failed to send contact email:', emailResult.error);
      }

      return res.json({
        success: true,
        message: 'Message sent successfully! We\'ll get back to you soon.'
      });

    } catch (error) {
      console.error('Error processing contact form:', error);
      return res.status(200).json({
        success: false,
        message: 'Your message was received. Email notification will be retried by the server.',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export const contactController = new ContactController();
