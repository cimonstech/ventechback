import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../utils/supabaseClient';
import { settingsService } from './settings.service';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

interface UserPreferences {
  email_notifications: boolean;
  newsletter_subscribed: boolean;
  sms_notifications: boolean;
}

class EnhancedEmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Get user communication preferences
  private async getUserPreferences(userId: string): Promise<UserPreferences> {
    try {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('email_notifications, newsletter_subscribed, sms_notifications')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('Error fetching user preferences:', error);
        // Return default preferences if user not found
        return {
          email_notifications: true,
          newsletter_subscribed: false,
          sms_notifications: true,
        };
      }

      return {
        email_notifications: data.email_notifications ?? true,
        newsletter_subscribed: data.newsletter_subscribed ?? false,
        sms_notifications: data.sms_notifications ?? true,
      };
    } catch (error) {
      console.error('Error fetching user preferences:', error);
      return {
        email_notifications: true,
        newsletter_subscribed: false,
        sms_notifications: true,
      };
    }
  }

  // Check if user wants to receive emails
  private async shouldSendEmail(userId: string, emailType: 'transactional' | 'newsletter' | 'marketing'): Promise<boolean> {
    const preferences = await this.getUserPreferences(userId);
    
    switch (emailType) {
      case 'transactional':
        return preferences.email_notifications;
      case 'newsletter':
        return preferences.newsletter_subscribed;
      case 'marketing':
        return preferences.newsletter_subscribed;
      default:
        return true;
    }
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      const mailOptions = {
        from: `"VENTECH Gadgets" <${process.env.SMTP_USER}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        attachments: options.attachments,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Email sent successfully:', result.messageId);
      return true;
    } catch (error) {
      console.error('Error sending email:', error);
      return false;
    }
  }

  // Enhanced order confirmation email with preference check
  async sendOrderConfirmation(orderData: any): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      // Check if email notifications are enabled in settings
      const emailNotificationsEnabled = await settingsService.isEnabled('email_notifications_enabled');
      if (!emailNotificationsEnabled) {
        console.log('Email notifications are disabled in settings');
        return { success: true, skipped: true, reason: 'Email notifications disabled in settings' };
      }

      // Check if order confirmation emails are enabled
      const orderConfirmationEnabled = await settingsService.isEnabled('email_order_confirmation');
      if (!orderConfirmationEnabled) {
        console.log('Order confirmation emails are disabled in settings');
        return { success: true, skipped: true, reason: 'Order confirmation emails disabled in settings' };
      }

      // Check if user wants to receive transactional emails
      const shouldSend = await this.shouldSendEmail(orderData.user_id, 'transactional');
      
      if (!shouldSend) {
        console.log(`Skipping order confirmation email for user ${orderData.user_id} - email notifications disabled`);
        return { success: true, skipped: true, reason: 'User has disabled email notifications' };
      }

      const templatePath = path.join(__dirname, '../../email-templates/order-confirmation.html');
      let template = fs.readFileSync(templatePath, 'utf8');

      // Replace placeholders with actual data
      template = template
        .replace('{{ORDER_NUMBER}}', orderData.order_number)
        .replace('{{CUSTOMER_NAME}}', orderData.customer_name)
        .replace('{{ORDER_DATE}}', new Date(orderData.created_at).toLocaleDateString())
        .replace('{{TOTAL_AMOUNT}}', `GHS ${orderData.total.toFixed(2)}`)
        .replace('{{DELIVERY_ADDRESS}}', this.formatAddress(orderData.delivery_address))
        .replace('{{ITEMS_LIST}}', this.formatOrderItems(orderData.items));

      const success = await this.sendEmail({
        to: orderData.customer_email,
        subject: `Order Confirmation - ${orderData.order_number}`,
        html: template,
      });

      return { success };
    } catch (error) {
      console.error('Error sending order confirmation:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Enhanced order status update email with preference check
  async sendOrderStatusUpdate(orderData: any, newStatus: string): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      // Check if email notifications are enabled in settings
      const emailNotificationsEnabled = await settingsService.isEnabled('email_notifications_enabled');
      if (!emailNotificationsEnabled) {
        console.log('Email notifications are disabled in settings');
        return { success: true, skipped: true, reason: 'Email notifications disabled in settings' };
      }

      // Check specific email type settings
      let emailTypeEnabled = false;
      if (newStatus === 'shipped') {
        emailTypeEnabled = await settingsService.isEnabled('email_order_shipped');
      } else if (newStatus === 'delivered') {
        emailTypeEnabled = await settingsService.isEnabled('email_order_delivered');
      } else {
        // For other statuses, check general order confirmation setting
        emailTypeEnabled = await settingsService.isEnabled('email_order_confirmation');
      }

      if (!emailTypeEnabled) {
        console.log(`Email type ${newStatus} is disabled in settings`);
        return { success: true, skipped: true, reason: `Email type ${newStatus} disabled in settings` };
      }

      // Check if user wants to receive transactional emails
      const shouldSend = await this.shouldSendEmail(orderData.user_id, 'transactional');
      
      if (!shouldSend) {
        console.log(`Skipping order status update email for user ${orderData.user_id} - email notifications disabled`);
        return { success: true, skipped: true, reason: 'User has disabled email notifications' };
      }

      const templatePath = path.join(__dirname, '../../email-templates/order-status-update.html');
      let template = fs.readFileSync(templatePath, 'utf8');

      template = template
        .replace('{{ORDER_NUMBER}}', orderData.order_number)
        .replace('{{CUSTOMER_NAME}}', orderData.customer_name)
        .replace('{{NEW_STATUS}}', newStatus)
        .replace('{{ORDER_DATE}}', new Date(orderData.created_at).toLocaleDateString())
        .replace('{{TOTAL_AMOUNT}}', `GHS ${orderData.total.toFixed(2)}`);

      const success = await this.sendEmail({
        to: orderData.customer_email,
        subject: `Order Update - ${orderData.order_number}`,
        html: template,
      });

      return { success };
    } catch (error) {
      console.error('Error sending order status update:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Enhanced newsletter email with preference check
  async sendNewsletter(userId: string, subject: string, content: string): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      // Check if email notifications are enabled in settings
      const emailNotificationsEnabled = await settingsService.isEnabled('email_notifications_enabled');
      if (!emailNotificationsEnabled) {
        console.log('Email notifications are disabled in settings');
        return { success: true, skipped: true, reason: 'Email notifications disabled in settings' };
      }

      // Check if user wants to receive newsletter emails
      const shouldSend = await this.shouldSendEmail(userId, 'newsletter');
      
      if (!shouldSend) {
        console.log(`Skipping newsletter email for user ${userId} - newsletter subscription disabled`);
        return { success: true, skipped: true, reason: 'User has unsubscribed from newsletter' };
      }

      // Get user email
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('id', userId)
        .single();

      if (error || !user) {
        return { success: false, reason: 'User not found' };
      }

      const success = await this.sendEmail({
        to: user.email,
        subject: subject,
        html: content,
      });

      return { success };
    } catch (error) {
      console.error('Error sending newsletter:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Helper methods (same as original)
  private formatAddress(address: any): string {
    if (!address) return 'No address provided';
    
    const parts = [
      address.street_address || address.street,
      address.city,
      address.region,
      address.postal_code,
      address.country || 'Ghana'
    ].filter(Boolean);
    
    if (address.full_name) parts.unshift(address.full_name);
    if (address.phone) parts.push(`Phone: ${address.phone}`);
    
    return parts.join(', ');
  }

  private formatOrderItems(items: any[]): string {
    if (!items || items.length === 0) return 'No items';
    
    return items.map(item => {
      const unitPrice = item.unit_price || item.price || 0;
      const subtotal = item.subtotal || (unitPrice * (item.quantity || 0));
      return `<tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.product_name || 'Product'}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.quantity || 0}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">GHS ${unitPrice.toFixed(2)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">GHS ${subtotal.toFixed(2)}</td>
      </tr>`;
    }).join('');
  }

  // Send admin order notification email
  async sendAdminOrderNotification(orderData: any): Promise<{ success: boolean; reason?: string }> {
    try {
      const templatePath = path.join(__dirname, '../../email-templates/admin-order-notification.html');
      
      // Check if template exists, otherwise create inline template
      let template: string;
      if (fs.existsSync(templatePath)) {
        template = fs.readFileSync(templatePath, 'utf8');
      } else {
        // Inline template for admin notification
        template = `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #FF7A19; color: white; padding: 20px; text-align: center; }
              .content { background: #f9f9f9; padding: 20px; }
              .order-info { background: white; padding: 15px; margin: 15px 0; border-left: 4px solid #FF7A19; }
              .item { padding: 10px; border-bottom: 1px solid #eee; }
              .total { font-size: 18px; font-weight: bold; color: #FF7A19; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>New Order Received</h1>
              </div>
              <div class="content">
                <div class="order-info">
                  <h2>Order #{{ORDER_NUMBER}}</h2>
                  <p><strong>Customer:</strong> {{CUSTOMER_NAME}}</p>
                  <p><strong>Email:</strong> {{CUSTOMER_EMAIL}}</p>
                  <p><strong>Date:</strong> {{ORDER_DATE}}</p>
                  <p><strong>Total:</strong> GHS {{TOTAL_AMOUNT}}</p>
                </div>
                <h3>Order Items:</h3>
                {{ITEMS_LIST}}
                <div class="total">
                  Total Amount: GHS {{TOTAL_AMOUNT}}
                </div>
                <p><strong>Delivery Address:</strong></p>
                <p>{{DELIVERY_ADDRESS}}</p>
              </div>
            </div>
          </body>
          </html>
        `;
      }

      // Replace placeholders
      template = template
        .replace(/{{ORDER_NUMBER}}/g, orderData.order_number)
        .replace(/{{CUSTOMER_NAME}}/g, orderData.customer_name || 'Guest Customer')
        .replace(/{{CUSTOMER_EMAIL}}/g, orderData.customer_email || 'No email')
        .replace(/{{ORDER_DATE}}/g, new Date(orderData.created_at).toLocaleString())
        .replace(/{{TOTAL_AMOUNT}}/g, orderData.total.toFixed(2))
        .replace(/{{DELIVERY_ADDRESS}}/g, this.formatAddress(orderData.delivery_address))
        .replace(/{{ITEMS_LIST}}/g, this.formatOrderItems(orderData.items || []));

      const success = await this.sendEmail({
        to: 'ventechgadget@gmail.com',
        subject: `New Order Received - ${orderData.order_number}`,
        html: template,
      });

      return { success };
    } catch (error) {
      console.error('Error sending admin order notification:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Enhanced wishlist reminder email with settings check
  async sendWishlistReminder(userId: string, wishlistItems: any[]): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      // Check if email notifications are enabled in settings
      const emailNotificationsEnabled = await settingsService.isEnabled('email_notifications_enabled');
      if (!emailNotificationsEnabled) {
        console.log('Email notifications are disabled in settings');
        return { success: true, skipped: true, reason: 'Email notifications disabled in settings' };
      }

      // Check if wishlist reminder emails are enabled
      const wishlistRemindersEnabled = await settingsService.isEnabled('email_wishlist_reminders');
      if (!wishlistRemindersEnabled) {
        console.log('Wishlist reminder emails are disabled in settings');
        return { success: true, skipped: true, reason: 'Wishlist reminder emails disabled in settings' };
      }

      // Check if user wants to receive emails
      const shouldSend = await this.shouldSendEmail(userId, 'marketing');
      if (!shouldSend) {
        console.log(`Skipping wishlist reminder email for user ${userId} - email notifications disabled`);
        return { success: true, skipped: true, reason: 'User has disabled email notifications' };
      }

      // Get user email
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', userId)
        .single();

      if (error || !user) {
        return { success: false, reason: 'User not found' };
      }

      const templatePath = path.join(__dirname, '../../email-templates/wishlist-reminder.html');
      let template = fs.readFileSync(templatePath, 'utf8');

      const customerName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer';
      template = template
        .replace('{{CUSTOMER_NAME}}', customerName)
        .replace('{{WISHLIST_ITEMS}}', this.formatWishlistItems(wishlistItems));

      const success = await this.sendEmail({
        to: user.email,
        subject: 'Items in your wishlist are waiting!',
        html: template,
      });

      return { success };
    } catch (error) {
      console.error('Error sending wishlist reminder:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Enhanced cart abandonment reminder email with settings check
  async sendCartAbandonmentReminder(userId: string, cartItems: any[]): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      // Check if email notifications are enabled in settings
      const emailNotificationsEnabled = await settingsService.isEnabled('email_notifications_enabled');
      if (!emailNotificationsEnabled) {
        console.log('Email notifications are disabled in settings');
        return { success: true, skipped: true, reason: 'Email notifications disabled in settings' };
      }

      // Check if cart abandonment emails are enabled
      const cartAbandonmentEnabled = await settingsService.isEnabled('email_cart_abandonment');
      if (!cartAbandonmentEnabled) {
        console.log('Cart abandonment emails are disabled in settings');
        return { success: true, skipped: true, reason: 'Cart abandonment emails disabled in settings' };
      }

      // Check if user wants to receive emails
      const shouldSend = await this.shouldSendEmail(userId, 'marketing');
      if (!shouldSend) {
        console.log(`Skipping cart abandonment reminder email for user ${userId} - email notifications disabled`);
        return { success: true, skipped: true, reason: 'User has disabled email notifications' };
      }

      // Get user email
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', userId)
        .single();

      if (error || !user) {
        return { success: false, reason: 'User not found' };
      }

      const templatePath = path.join(__dirname, '../../email-templates/cart-abandonment.html');
      let template = fs.readFileSync(templatePath, 'utf8');

      const customerName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer';
      template = template
        .replace('{{CUSTOMER_NAME}}', customerName)
        .replace('{{CART_ITEMS}}', this.formatCartItems(cartItems));

      const success = await this.sendEmail({
        to: user.email,
        subject: 'Don\'t forget your items!',
        html: template,
      });

      return { success };
    } catch (error) {
      console.error('Error sending cart abandonment reminder:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Format wishlist items for email
  private formatWishlistItems(items: any[]): string {
    if (!items || items.length === 0) return '<p>No items in wishlist</p>';
    
    return items.map(item => `
      <div style="padding: 15px; border-bottom: 1px solid #eee;">
        <h4 style="margin: 0 0 10px 0; color: #FF7A19;">${item.product_name || 'Unknown Product'}</h4>
        <p style="margin: 0; color: #666;">${item.product_description || ''}</p>
        <p style="margin: 5px 0 0 0; font-weight: bold; color: #333;">GHS ${(item.product_price || 0).toFixed(2)}</p>
      </div>
    `).join('');
  }

  // Format cart items for email
  private formatCartItems(items: any[]): string {
    if (!items || items.length === 0) return '<p>No items in cart</p>';
    
    return items.map(item => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.product_name || 'Unknown Product'}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.quantity || 1}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">GHS ${(item.price || 0).toFixed(2)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">GHS ${((item.price || 0) * (item.quantity || 1)).toFixed(2)}</td>
      </tr>
    `).join('');
  }

  // Investment email (no preference check needed - always send to admin)
  async sendInvestmentEmail(investmentData: any): Promise<{ success: boolean; error?: string }> {
    try {
      const { fullName, email, phone, tier, amount, plan, message } = investmentData;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>New Investment Request - VENTECH</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #FF7A19;">New Investment Request - VENTECH Laptop Banking</h2>
            
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Investment Details</h3>
              <p><strong>Name:</strong> ${fullName}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Phone:</strong> ${phone}</p>
              <p><strong>Tier:</strong> ${tier}</p>
              <p><strong>Amount:</strong> GHS ${amount}</p>
              <p><strong>Plan:</strong> ${plan}</p>
              ${message ? `<p><strong>Message:</strong> ${message}</p>` : ''}
            </div>
            
            <p>This investment request was submitted through the VENTECH website.</p>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
              <p>VENTECH Gadgets - Your Trusted Tech Partner</p>
              <p>Email: ventechgadgets@gmail.com | Phone: +233 55 134 4310</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const success = await this.sendEmail({
        to: 'ventechgadgets@gmail.com',
        subject: `New Investment Request - ${fullName}`,
        html: html,
      });

      return { success };
    } catch (error) {
      console.error('Error sending investment email:', error);
      return { success: false, error: 'Failed to send investment email' };
    }
  }
}

export default new EnhancedEmailService();
export { sendInvestmentEmail } from './email.service';
