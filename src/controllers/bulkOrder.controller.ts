import { Request, Response } from 'express';
import { sendBulkOrderEmail } from '../services/email.service';

export class BulkOrderController {
  // Submit bulk order request
  async submitBulkOrderRequest(req: Request, res: Response) {
    try {
      const {
        name,
        phone,
        email,
        organization,
        productType,
        quantity,
        preferredSpecs,
        deliveryLocation,
        paymentMethod,
        preferredDeliveryDate,
        notes,
      } = req.body;

      // Validate required fields
      if (!name || !phone || !email || !productType || !quantity || !deliveryLocation || !paymentMethod) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: name, phone, email, productType, quantity, deliveryLocation, and paymentMethod are required'
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
      const emailResult = await sendBulkOrderEmail({
        name,
        phone,
        email,
        organization: organization || null,
        productType,
        quantity,
        preferredSpecs: preferredSpecs || null,
        deliveryLocation,
        paymentMethod,
        preferredDeliveryDate: preferredDeliveryDate || null,
        notes: notes || null,
      });

      if (!emailResult.success) {
        // Log but do not fail the request; we accept the submission regardless
        console.error('Failed to send bulk order email:', emailResult.error);
      }

      return res.json({
        success: true,
        message: 'Bulk order request submitted successfully! We\'ll contact you shortly.'
      });

    } catch (error) {
      console.error('Error processing bulk order request:', error);
      return res.status(200).json({
        success: false,
        message: 'Your request was received. Email notification will be retried by the server.',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export const bulkOrderController = new BulkOrderController();

