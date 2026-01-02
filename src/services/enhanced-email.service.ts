import { Resend } from 'resend';
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
  private resend: Resend;
  private supportEmail: string;
  private noreplyEmail: string;

  constructor() {
    const resendApiKey = process.env.RESEND_API_KEY;
    
    if (!resendApiKey) {
      console.error('❌ RESEND_API_KEY is missing in .env file');
      throw new Error('RESEND_API_KEY is required');
    }

    this.resend = new Resend(resendApiKey);
    
    // Support email for customer-facing emails (order confirmations, replies, etc.)
    this.supportEmail = process.env.RESEND_SUPPORT_EMAIL || 'VENTECH GADGETS <support@ventechgadgets.com>';
    
    // No-reply email for automated notifications (system updates, password resets, etc.)
    this.noreplyEmail = process.env.RESEND_NOREPLY_EMAIL || 'VENTECH GADGETS <noreply@ventechgadgets.com>';
    
    console.log('✅ Resend email service initialized');
    console.log(`   Support Email: ${this.supportEmail}`);
    console.log(`   No-Reply Email: ${this.noreplyEmail}`);
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

  async sendEmail(options: EmailOptions, useSupportEmail: boolean = true): Promise<boolean> {
    try {
      // Convert attachments to Resend format if provided
      const attachments = options.attachments?.map(att => ({
        filename: att.filename,
        content: att.content.toString('base64'),
      })) || [];

      // Use support email for customer-facing emails, noreply for automated notifications
      const fromEmail = useSupportEmail ? this.supportEmail : this.noreplyEmail;

      const { data, error } = await this.resend.emails.send({
        from: fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (error) {
        console.error('❌ Error sending email via Resend:', {
          error,
          message: (error as any)?.message || 'Unknown error',
          code: (error as any)?.code,
          details: (error as any)?.details,
          to: options.to,
          subject: options.subject,
          from: fromEmail,
        });
        return false;
      }

      console.log(`✅ Email sent successfully via Resend [${useSupportEmail ? 'Support' : 'No-Reply'}] to ${options.to}:`, data?.id);
      return true;
    } catch (error) {
      console.error('Error sending email:', error);
      return false;
    }
  }

  // Enhanced order confirmation email with preference check
  async sendOrderConfirmation(orderData: any): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      // ALWAYS send order confirmation emails - these are critical transactional emails
      // User preferences should NOT block order confirmations (only marketing emails)
      // Order confirmations are required for order tracking and legal purposes
      // Removed preference check - transactional emails must always be sent

      // Email templates are in backend/email-templates folder (or project root)
      // Try multiple path resolutions for reliability
      let templatePath = path.join(__dirname, '../../email-templates/order-confirmation.html');
      
      // If not found, try from backend root (current working directory)
      if (!fs.existsSync(templatePath)) {
        const backendRoot = process.cwd();
        templatePath = path.join(backendRoot, 'email-templates', 'order-confirmation.html');
      }
      
      // If still not found, try from project root (one level up from backend)
      if (!fs.existsSync(templatePath)) {
        const backendRoot = process.cwd();
        templatePath = path.join(backendRoot, '..', 'email-templates', 'order-confirmation.html');
      }
      
      // Last resort: try from compiled dist location
      if (!fs.existsSync(templatePath)) {
        templatePath = path.join(__dirname, '../../../../email-templates/order-confirmation.html');
      }
      
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Email template not found. Tried: ${templatePath}. Current dir: ${__dirname}, CWD: ${process.cwd()}`);
      }
      
      let template = fs.readFileSync(templatePath, 'utf8');

      // Extract is_pre_order flag
      const isPreOrder = orderData.is_pre_order || false;
      const orderTypeTag = isPreOrder ? 'PRE-ORDER' : 'REGULAR';
      const orderTypeBadge = isPreOrder 
        ? '<span style="background-color: #000000; color: #ffffff; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; display: inline-block; margin-left: 10px;">PRE-ORDER</span>'
        : '<span style="background-color: #10b981; color: #ffffff; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; display: inline-block; margin-left: 10px;">REGULAR</span>';

      // Calculate values for placeholders
      const subtotal = orderData.subtotal || (orderData.items || []).reduce((sum: number, item: any) => sum + (item.subtotal || (item.unit_price || 0) * (item.quantity || 0)), 0);
      const shippingFee = orderData.shipping_fee || orderData.delivery_fee || 0;
      const total = orderData.total || (subtotal + shippingFee);
      
      // Format payment method
      const paymentMethod = orderData.payment_method || 'Cash on Delivery';
      const paymentMethodDisplay = paymentMethod === 'paystack' ? 'Paystack (Online Payment)' 
        : paymentMethod === 'cash_on_delivery' ? 'Cash on Delivery'
        : paymentMethod === 'bank_transfer' ? 'Bank Transfer'
        : paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1).replace(/_/g, ' ');
      
      // Format payment status
      const paymentStatus = orderData.payment_status || 'pending';
      const paymentStatusDisplay = paymentStatus === 'paid' ? 'Paid' 
        : paymentStatus === 'pending' ? 'Pending'
        : paymentStatus === 'failed' ? 'Failed'
        : paymentStatus === 'refunded' ? 'Refunded'
        : paymentStatus.charAt(0).toUpperCase() + paymentStatus.slice(1);
      
      // Calculate estimated delivery
      let estimatedDelivery = 'TBD';
      if (isPreOrder && orderData.estimated_arrival_date) {
        estimatedDelivery = new Date(orderData.estimated_arrival_date).toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      } else if (orderData.delivery_address?.delivery_option?.estimated_days) {
        const days = orderData.delivery_address.delivery_option.estimated_days;
        const deliveryDate = new Date();
        deliveryDate.setDate(deliveryDate.getDate() + days);
        estimatedDelivery = deliveryDate.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      }
      
      // Generate URLs
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'https://ventechgadgets.com';
      const trackingUrl = `${siteUrl}/track-order`;
      const contactUrl = `${siteUrl}/contact`;
      
      // Get logo URL from R2 storage (ventech_logo_1.png)
      const r2PublicUrl = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_IMAGES_URL || process.env.IMAGES_URL;
      const r2AccountId = process.env.R2_ACCOUNT_ID;
      
      // Use direct logo URL
      const logoUrl = 'https://files.ventechgadgets.com/ventech_logo_1.png';
      
      // Determine shipping label: "Delivery" for regular orders, "Shipment" for pre-orders
      const shippingLabel = isPreOrder ? 'Shipment' : 'Delivery';
      
      // Determine preparation message: "shipment" for pre-orders, "delivery" for regular orders
      const preparationMessage = isPreOrder 
        ? "We've received your order and are preparing it for shipment."
        : "We've received your order and are preparing it for delivery.";
      
      // Format delivery details
      const deliveryAddress = orderData.delivery_address || orderData.shipping_address || {};
      const gadgetName = deliveryAddress.gadget_name || 'N/A';
      const recipientName = deliveryAddress.recipient_name || deliveryAddress.full_name || orderData.customer_name || 'N/A';
      const recipientNumber = deliveryAddress.recipient_number || deliveryAddress.phone || orderData.customer_phone || 'N/A';
      const deliveryLocation = deliveryAddress.recipient_location || deliveryAddress.location || deliveryAddress.street_address || deliveryAddress.street || 'N/A';
      const deliveryRegion = deliveryAddress.recipient_region || deliveryAddress.region || deliveryAddress.city || 'N/A';
      const deliveryCountry = deliveryAddress.country || 'Ghana';
      const alternateContact = deliveryAddress.alternate_contact_number 
        ? `<p style="font-size:13px; color:#3A3A3A; margin:5px 0;"><strong>Alternate Contact:</strong> ${deliveryAddress.alternate_contact_number}</p>`
        : '';

      // Replace placeholders with actual data
      template = template
        .replace(/{{ORDER_NUMBER}}/g, orderData.order_number || 'N/A')
        .replace(/{{CUSTOMER_NAME}}/g, orderData.customer_name || 'Customer')
        .replace(/{{CUSTOMER_EMAIL}}/g, orderData.customer_email || 'N/A')
        .replace(/{{ORDER_PREPARATION_MESSAGE}}/g, preparationMessage)
        .replace(/{{ORDER_DATE}}/g, orderData.created_at ? new Date(orderData.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A')
        .replace(/{{TOTAL_AMOUNT}}/g, `GHS ${total.toFixed(2)}`)
        .replace(/{{SUBTOTAL}}/g, subtotal.toFixed(2))
        .replace(/{{SHIPPING_LABEL}}/g, shippingLabel)
        .replace(/{{SHIPPING}}/g, shippingFee.toFixed(2))
        .replace(/{{TOTAL}}/g, total.toFixed(2))
        .replace(/{{PAYMENT_METHOD}}/g, paymentMethodDisplay)
        .replace(/{{PAYMENT_STATUS}}/g, paymentStatusDisplay)
        .replace(/{{ESTIMATED_DELIVERY}}/g, estimatedDelivery)
        .replace(/{{TRACKING_URL}}/g, trackingUrl)
        .replace(/{{CONTACT_URL}}/g, contactUrl)
        .replace(/{{LOGO_URL}}/g, logoUrl)
        .replace(/{{DELIVERY_ADDRESS}}/g, this.formatAddress(orderData.delivery_address))
        .replace(/{{SHIPPING_ADDRESS}}/g, this.formatAddress(orderData.delivery_address))
        .replace(/{{GADGET_NAME}}/g, gadgetName)
        .replace(/{{RECIPIENT_NAME}}/g, recipientName)
        .replace(/{{RECIPIENT_NUMBER}}/g, recipientNumber)
        .replace(/{{DELIVERY_LOCATION}}/g, deliveryLocation)
        .replace(/{{DELIVERY_REGION}}/g, deliveryRegion)
        .replace(/{{DELIVERY_COUNTRY}}/g, deliveryCountry)
        .replace(/{{ALTERNATE_CONTACT}}/g, alternateContact)
        .replace(/{{ITEMS_LIST}}/g, this.formatOrderItems(orderData.items || []))
        .replace(/{{ORDER_ITEMS}}/g, this.formatOrderItems(orderData.items || []))
        .replace(/{{ORDER_NOTES}}/g, orderData.notes ? `<div style="background-color: #f9f9f9; border-radius: 8px; padding: 15px; margin: 20px 0;"><h3 style="color: #1A1A1A; font-size: 16px; margin: 0 0 10px 0;">Order Notes:</h3><p style="color: #3A3A3A; font-size: 14px; margin: 0;">${orderData.notes}</p></div>` : '')
        .replace(/{{ORDER_TYPE_BADGE}}/g, orderTypeBadge);

      // Add pre-order specific information if applicable
      let preOrderInfo = '';
      if (isPreOrder) {
        const shippingMethod = orderData.pre_order_shipping_option || 'Not specified';
        const estimatedArrival = orderData.estimated_arrival_date 
          ? new Date(orderData.estimated_arrival_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          : 'TBD';
        
        preOrderInfo = `
          <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <h3 style="color: #856404; font-size: 16px; margin: 0 0 10px 0;">Pre-Order Information</h3>
            <p style="color: #856404; font-size: 14px; margin: 5px 0;"><strong>Shipping Method:</strong> ${shippingMethod}</p>
            <p style="color: #856404; font-size: 14px; margin: 5px 0;"><strong>Estimated Arrival:</strong> ${estimatedArrival}</p>
          </div>
        `;
      }
      template = template.replace(/{{PRE_ORDER_INFO}}/g, preOrderInfo);

      // Use support email for order confirmations (customers can reply)
      if (!orderData.customer_email) {
        console.error('❌ No customer email provided for order confirmation:', orderData.order_number);
        return { success: false, reason: 'No customer email provided' };
      }

      console.log(`📧 Sending order confirmation email to: ${orderData.customer_email}`);
      const success = await this.sendEmail({
        to: orderData.customer_email,
        subject: `[${orderTypeTag}] Order Confirmation - ${orderData.order_number}`,
        html: template,
      }, true); // true = use support email

      if (!success) {
        console.error('❌ Failed to send order confirmation email to:', orderData.customer_email);
      }

      return { success };
    } catch (error) {
      console.error('Error sending order confirmation:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Enhanced order status update email with preference check
  async sendOrderStatusUpdate(orderData: any, newStatus: string): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      // ALWAYS send order status update emails - these are critical transactional emails
      // User preferences should NOT block order status updates (only marketing emails)
      // Order status updates are required for order tracking and customer communication

      // Extract is_pre_order flag
      const isPreOrder = orderData.is_pre_order || false;
      const orderTypeTag = isPreOrder ? 'PRE-ORDER' : 'REGULAR';
      const orderTypeBadge = isPreOrder 
        ? '<span style="background-color: #000000; color: #ffffff; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; display: inline-block; margin-left: 10px;">PRE-ORDER</span>'
        : '<span style="background-color: #10b981; color: #ffffff; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; display: inline-block; margin-left: 10px;">REGULAR</span>';

      // Email templates are in backend/email-templates folder (or project root)
      // Try multiple path resolutions for reliability
      let templatePath = path.join(__dirname, '../../email-templates/order-status-update.html');
      
      // If not found, try from backend root (current working directory)
      if (!fs.existsSync(templatePath)) {
        const backendRoot = process.cwd();
        templatePath = path.join(backendRoot, 'email-templates', 'order-status-update.html');
      }
      
      // If still not found, try from project root (one level up from backend)
      if (!fs.existsSync(templatePath)) {
        const backendRoot = process.cwd();
        templatePath = path.join(backendRoot, '..', 'email-templates', 'order-status-update.html');
      }
      
      // Try from compiled dist location (relative to dist/services)
      if (!fs.existsSync(templatePath)) {
        templatePath = path.join(__dirname, '../../../../email-templates/order-status-update.html');
      }
      
      // Try absolute path for VPS deployment (/var/www/ventech/backend/email-templates/)
      if (!fs.existsSync(templatePath)) {
        templatePath = '/var/www/ventech/backend/email-templates/order-status-update.html';
      }
      
      // Last resort: try from backend directory relative to dist
      if (!fs.existsSync(templatePath)) {
        templatePath = path.join(__dirname, '../../../email-templates/order-status-update.html');
      }
      
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Email template not found. Tried: ${templatePath}. Current dir: ${__dirname}, CWD: ${process.cwd()}`);
      }
      
      let template = fs.readFileSync(templatePath, 'utf8');

      // Replace placeholders with actual data
      template = template
        .replace(/{{ORDER_NUMBER}}/g, orderData.order_number)
        .replace(/{{CUSTOMER_NAME}}/g, orderData.customer_name)
        .replace(/{{NEW_STATUS}}/g, newStatus.charAt(0).toUpperCase() + newStatus.slice(1))
        .replace(/{{ORDER_DATE}}/g, new Date(orderData.created_at).toLocaleDateString())
        .replace(/{{TOTAL_AMOUNT}}/g, `GHS ${orderData.total.toFixed(2)}`)
        .replace(/{{ORDER_TYPE_BADGE}}/g, orderTypeBadge);

      // Add pre-order specific information if applicable
      let preOrderInfo = '';
      if (isPreOrder) {
        preOrderInfo = `
          <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <h3 style="color: #856404; font-size: 16px; margin: 0 0 10px 0;">Pre-Order Information</h3>
            ${orderData.pre_order_shipping_option ? `<p style="color: #856404; font-size: 14px; margin: 5px 0;"><strong>Shipping Method:</strong> ${orderData.pre_order_shipping_option}</p>` : ''}
            ${orderData.estimated_arrival_date ? `<p style="color: #856404; font-size: 14px; margin: 5px 0;"><strong>Estimated Arrival:</strong> ${new Date(orderData.estimated_arrival_date).toLocaleDateString()}</p>` : ''}
          </div>
        `;
      }
      template = template.replace(/{{PRE_ORDER_INFO}}/g, preOrderInfo);

      // Use support email for order status updates (customers can reply)
      if (!orderData.customer_email) {
        console.error('❌ No customer email provided for order status update:', orderData.order_number);
        return { success: false, reason: 'No customer email provided' };
      }

      console.log(`📧 Sending order status update email to: ${orderData.customer_email}`);
      const success = await this.sendEmail({
        to: orderData.customer_email,
        subject: `[${orderTypeTag}] Order Update - ${orderData.order_number}`,
        html: template,
      }, true); // true = use support email

      if (!success) {
        console.error('❌ Failed to send order status update email to:', orderData.customer_email);
      }

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

      // Use noreply for newsletters (automated, no reply needed)
      const success = await this.sendEmail({
        to: user.email,
        subject: subject,
        html: content,
      }, false); // false = use noreply email

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
    
    // Get image base URL from environment
    const imagesBaseUrl = process.env.NEXT_PUBLIC_IMAGES_URL || process.env.IMAGES_URL || 'https://images.ventechgadgets.com';
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    
    return items.map(item => {
      // Ensure unitPrice is a number
      const unitPrice = Number(item.unit_price || item.price || 0);
      const subtotal = Number(item.subtotal || (unitPrice * (item.quantity || 0)));
      
      // Get product image URL - try multiple possible fields
      let imageUrl = item.product_image || item.thumbnail || item.image_url || item.image || '';
      
      // Handle different URL formats
      if (imageUrl) {
        // If it's already a full URL (http/https), use it as-is
        if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
          // Already a full URL, use as-is
        }
        // If it starts with /storage/, it's a Supabase storage path
        else if (imageUrl.startsWith('/storage/') || imageUrl.startsWith('storage/')) {
          const cleanPath = imageUrl.replace(/^\/?storage\/v1\/object\/public\//, '');
          if (supabaseUrl) {
            imageUrl = `${supabaseUrl}/storage/v1/object/public/${cleanPath}`;
          } else {
            // Fallback to images base URL if Supabase URL not available
            imageUrl = `${imagesBaseUrl}/${cleanPath}`;
          }
        }
        // If it starts with /, prepend base URL
        else if (imageUrl.startsWith('/')) {
          imageUrl = `${imagesBaseUrl}${imageUrl}`;
        }
        // Otherwise, assume it's a storage path and construct Supabase URL or use base URL
        else {
          // Try Supabase storage first
          if (supabaseUrl) {
            imageUrl = `${supabaseUrl}/storage/v1/object/public/products/${imageUrl}`;
          } else {
            // Fallback to images base URL
            imageUrl = `${imagesBaseUrl}/${imageUrl}`;
          }
        }
      } else {
        // Fallback to placeholder if no image
        imageUrl = `${imagesBaseUrl}/placeholder-product.webp`;
      }
      
      // Check if item is pre-order
      const isPreOrder = item.is_pre_order || false;
      const preOrderBadge = isPreOrder 
        ? '<span style="background-color: #000000; color: #ffffff; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: bold; margin-left: 8px;">PRE-ORDER</span>'
        : '';
      
      return `<tr>
        <td style="padding: 15px; border-bottom: 1px solid #eee; vertical-align: top;">
          <table cellpadding="0" cellspacing="0" style="width: 100%;">
            <tr>
              <td style="width: 80px; padding-right: 15px; vertical-align: top;">
                <img src="${imageUrl}" alt="${item.product_name || 'Product'}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 6px; border: 1px solid #e0e0e0;" />
              </td>
              <td style="vertical-align: top;">
                <div style="font-weight: bold; color: #1A1A1A; margin-bottom: 5px; font-size: 14px;">
                  ${item.product_name || 'Product'}${preOrderBadge}
                </div>
                ${item.selected_variants && Object.keys(item.selected_variants).length > 0 ? `
                  <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    ${Object.values(item.selected_variants).map((variant: any) => 
                      `<span style="background-color: #f0f0f0; padding: 2px 6px; border-radius: 3px; margin-right: 5px; display: inline-block; margin-top: 3px;">
                        ${variant.name || variant.label || ''}: ${variant.value || ''}
                      </span>`
                    ).join('')}
                  </div>
                ` : ''}
              </td>
            </tr>
          </table>
        </td>
        <td style="padding: 15px; border-bottom: 1px solid #eee; text-align: center; vertical-align: top;">
          <div style="font-weight: bold; color: #1A1A1A;">${item.quantity || 0}</div>
        </td>
        <td style="padding: 15px; border-bottom: 1px solid #eee; text-align: right; vertical-align: top;">
          <div style="color: #3A3A3A;">GHS ${unitPrice.toFixed(2)}</div>
        </td>
        <td style="padding: 15px; border-bottom: 1px solid #eee; text-align: right; vertical-align: top;">
          <div style="font-weight: bold; color: #FF7A19;">GHS ${subtotal.toFixed(2)}</div>
        </td>
      </tr>`;
    }).join('');
  }

  // Send admin order notification email
  async sendAdminOrderNotification(orderData: any): Promise<{ success: boolean; reason?: string }> {
    try {
      // Email templates are in the root email-templates folder
      const templatePath = path.join(__dirname, '../../../../email-templates/admin-order-notification.html');
      
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
                  <h2>Order #{{ORDER_NUMBER}} {{ORDER_TYPE_BADGE}}</h2>
                  <p><strong>Customer:</strong> {{CUSTOMER_NAME}}</p>
                  <p><strong>Email:</strong> {{CUSTOMER_EMAIL}}</p>
                  <p><strong>Date:</strong> {{ORDER_DATE}}</p>
                  <p><strong>Total:</strong> GHS {{TOTAL_AMOUNT}}</p>
                  {{ORDER_NOTES}}
                  {{PRE_ORDER_INFO}}
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

      // Extract is_pre_order flag
      const isPreOrder = orderData.is_pre_order || false;
      const orderTypeTag = isPreOrder ? 'PRE-ORDER' : 'REGULAR';
      const orderTypeBadge = isPreOrder 
        ? '<span style="background-color: #000000; color: #ffffff; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; display: inline-block; margin-left: 10px;">PRE-ORDER</span>'
        : '<span style="background-color: #10b981; color: #ffffff; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; display: inline-block; margin-left: 10px;">REGULAR</span>';

      // Replace placeholders
      template = template
        .replace(/{{ORDER_NUMBER}}/g, orderData.order_number)
        .replace(/{{CUSTOMER_NAME}}/g, orderData.customer_name || 'Guest Customer')
        .replace(/{{CUSTOMER_EMAIL}}/g, orderData.customer_email || 'No email')
        .replace(/{{ORDER_DATE}}/g, new Date(orderData.created_at).toLocaleString())
        .replace(/{{TOTAL_AMOUNT}}/g, orderData.total.toFixed(2))
        .replace(/{{DELIVERY_ADDRESS}}/g, this.formatAddress(orderData.delivery_address))
        .replace(/{{ITEMS_LIST}}/g, this.formatOrderItems(orderData.items || []))
        .replace(/{{ORDER_NOTES}}/g, orderData.notes ? `<div style="background-color: #f9f9f9; border-radius: 8px; padding: 15px; margin: 20px 0;"><h3 style="color: #1A1A1A; font-size: 16px; margin: 0 0 10px 0;">Order Notes:</h3><p style="color: #3A3A3A; font-size: 14px; margin: 0;">${orderData.notes}</p></div>` : '')
        .replace(/{{ORDER_TYPE_BADGE}}/g, orderTypeBadge);

      // Add pre-order specific information if applicable
      let preOrderInfo = '';
      if (isPreOrder) {
        preOrderInfo = `
          <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <h3 style="color: #856404; font-size: 16px; margin: 0 0 10px 0;">Pre-Order Information</h3>
            ${orderData.pre_order_shipping_option ? `<p style="color: #856404; font-size: 14px; margin: 5px 0;"><strong>Shipping Method:</strong> ${orderData.pre_order_shipping_option}</p>` : ''}
            ${orderData.estimated_arrival_date ? `<p style="color: #856404; font-size: 14px; margin: 5px 0;"><strong>Estimated Arrival:</strong> ${new Date(orderData.estimated_arrival_date).toLocaleDateString()}</p>` : ''}
          </div>
        `;
      }
      template = template.replace(/{{PRE_ORDER_INFO}}/g, preOrderInfo);

      // Use support email for admin notifications (they can reply)
      // Send to ventechgadgets@gmail.com
      const success = await this.sendEmail({
        to: 'ventechgadgets@gmail.com',
        subject: `[${orderTypeTag}] New Order Received - ${orderData.order_number}`,
        html: template,
      }, true); // true = use support email

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

      // Email templates are in the root email-templates folder
      const templatePath = path.join(__dirname, '../../../../email-templates/wishlist-reminder.html');
      let template = fs.readFileSync(templatePath, 'utf8');

      const customerName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer';
      template = template
        .replace('{{CUSTOMER_NAME}}', customerName)
        .replace('{{WISHLIST_ITEMS}}', this.formatWishlistItems(wishlistItems));

      // Use noreply for wishlist reminders (automated marketing)
      const success = await this.sendEmail({
        to: user.email,
        subject: 'Items in your wishlist are waiting!',
        html: template,
      }, false); // false = use noreply email

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

      // Email templates are in the root email-templates folder
      const templatePath = path.join(__dirname, '../../../../email-templates/cart-abandonment.html');
      let template = fs.readFileSync(templatePath, 'utf8');

      const customerName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer';
      template = template
        .replace('{{CUSTOMER_NAME}}', customerName)
        .replace('{{CART_ITEMS}}', this.formatCartItems(cartItems));

      // Use noreply for cart abandonment (automated marketing)
      const success = await this.sendEmail({
        to: user.email,
        subject: 'Don\'t forget your items!',
        html: template,
      }, false); // false = use noreply email

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

      // Use support email for investment requests (admin can reply)
      const success = await this.sendEmail({
        to: 'ventechgadgets@gmail.com',
        subject: `New Investment Request - ${fullName}`,
        html: html,
      }, true); // true = use support email

      return { success };
    } catch (error) {
      console.error('Error sending investment email:', error);
      return { success: false, error: 'Failed to send investment email' };
    }
  }
}

export default new EnhancedEmailService();
export { sendInvestmentEmail } from './email.service';
