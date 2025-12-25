import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';

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

class EmailService {
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
    
    // Support email for customer-facing emails
    this.supportEmail = process.env.RESEND_SUPPORT_EMAIL || 'VENTECH GADGETS <support@ventechgadgets.com>';
    
    // No-reply email for automated notifications
    this.noreplyEmail = process.env.RESEND_NOREPLY_EMAIL || 'VENTECH GADGETS <noreply@ventechgadgets.com>';
    
    console.log('✅ Resend email service initialized');
    console.log(`   Support Email: ${this.supportEmail}`);
    console.log(`   No-Reply Email: ${this.noreplyEmail}`);
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
          from: fromEmail,
          subject: options.subject,
        });
        return false;
      }

      console.log(`✅ Email sent successfully via Resend [${useSupportEmail ? 'Support' : 'No-Reply'}]:`, data?.id);
      return true;
    } catch (error) {
      console.error('Error sending email:', error);
      return false;
    }
  }

  // Order confirmation email
  async sendOrderConfirmation(orderData: any): Promise<boolean> {
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
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Email template not found. Tried: ${templatePath}. Current dir: ${__dirname}, CWD: ${process.cwd()}`);
    }
    
    let template = fs.readFileSync(templatePath, 'utf8');

    // Replace placeholders with actual data
    template = template
      .replace('{{ORDER_NUMBER}}', orderData.order_number)
      .replace('{{CUSTOMER_NAME}}', orderData.customer_name)
      .replace('{{ORDER_DATE}}', new Date(orderData.created_at).toLocaleDateString())
      .replace('{{TOTAL_AMOUNT}}', `GHS ${orderData.total.toFixed(2)}`)
      .replace('{{DELIVERY_ADDRESS}}', this.formatAddress(orderData.delivery_address))
      .replace('{{ITEMS_LIST}}', this.formatOrderItems(orderData.items));

    // Use support email for order confirmations (customers can reply)
    return this.sendEmail({
      to: orderData.customer_email,
      subject: `Order Confirmation - ${orderData.order_number}`,
      html: template,
    }, true); // true = use support email
  }

  // Order status update email
  async sendOrderStatusUpdate(orderData: any, newStatus: string): Promise<boolean> {
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
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Email template not found. Tried: ${templatePath}. Current dir: ${__dirname}, CWD: ${process.cwd()}`);
    }
    
    let template = fs.readFileSync(templatePath, 'utf8');

    template = template
      .replace('{{ORDER_NUMBER}}', orderData.order_number)
      .replace('{{CUSTOMER_NAME}}', orderData.customer_name)
      .replace('{{NEW_STATUS}}', newStatus)
      .replace('{{STATUS_MESSAGE}}', this.getStatusMessage(newStatus))
      .replace('{{TRACKING_NUMBER}}', orderData.tracking_number || 'Not available yet');

    // Use support email for order status updates (customers can reply)
    return this.sendEmail({
      to: orderData.customer_email,
      subject: `Order Update - ${orderData.order_number}`,
      html: template,
    }, true); // true = use support email
  }

  // Order cancellation email
  async sendOrderCancellation(orderData: any): Promise<boolean> {
    // Try multiple path resolutions for reliability
    let templatePath = path.join(__dirname, '../../email-templates/order-cancellation.html');
    
    // If not found, try from backend root (current working directory)
    if (!fs.existsSync(templatePath)) {
      const backendRoot = process.cwd();
      templatePath = path.join(backendRoot, 'email-templates', 'order-cancellation.html');
    }
    
    // If still not found, try from project root (one level up from backend)
    if (!fs.existsSync(templatePath)) {
      const backendRoot = process.cwd();
      templatePath = path.join(backendRoot, '..', 'email-templates', 'order-cancellation.html');
    }
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Email template not found. Tried: ${templatePath}. Current dir: ${__dirname}, CWD: ${process.cwd()}`);
    }
    
    let template = fs.readFileSync(templatePath, 'utf8');

    template = template
      .replace('{{ORDER_NUMBER}}', orderData.order_number)
      .replace('{{CUSTOMER_NAME}}', orderData.customer_name)
      .replace('{{CANCELLATION_REASON}}', orderData.cancellation_reason || 'No reason provided');

    // Use support email for order cancellations (customers can reply)
    return this.sendEmail({
      to: orderData.customer_email,
      subject: `Order Cancelled - ${orderData.order_number}`,
      html: template,
    }, true); // true = use support email
  }

  // Wishlist reminder email
  async sendWishlistReminder(userData: any, wishlistItems: any[]): Promise<boolean> {
    // Try multiple path resolutions for reliability
    let templatePath = path.join(__dirname, '../../email-templates/wishlist-reminder.html');
    
    // If not found, try from backend root (current working directory)
    if (!fs.existsSync(templatePath)) {
      const backendRoot = process.cwd();
      templatePath = path.join(backendRoot, 'email-templates', 'wishlist-reminder.html');
    }
    
    // If still not found, try from project root (one level up from backend)
    if (!fs.existsSync(templatePath)) {
      const backendRoot = process.cwd();
      templatePath = path.join(backendRoot, '..', 'email-templates', 'wishlist-reminder.html');
    }
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Email template not found. Tried: ${templatePath}. Current dir: ${__dirname}, CWD: ${process.cwd()}`);
    }
    
    let template = fs.readFileSync(templatePath, 'utf8');

    template = template
      .replace('{{CUSTOMER_NAME}}', userData.first_name || 'Customer')
      .replace('{{WISHLIST_ITEMS}}', this.formatWishlistItems(wishlistItems));

    // Use noreply for wishlist reminders (automated marketing)
    return this.sendEmail({
      to: userData.email,
      subject: 'Your Wishlist Items Are Waiting!',
      html: template,
    }, false); // false = use noreply email
  }

  // Cart abandonment email
  async sendCartAbandonmentReminder(userData: any, cartItems: any[]): Promise<boolean> {
    // Try multiple path resolutions for reliability
    let templatePath = path.join(__dirname, '../../email-templates/cart-abandonment.html');
    
    // If not found, try from backend root (current working directory)
    if (!fs.existsSync(templatePath)) {
      const backendRoot = process.cwd();
      templatePath = path.join(backendRoot, 'email-templates', 'cart-abandonment.html');
    }
    
    // If still not found, try from project root (one level up from backend)
    if (!fs.existsSync(templatePath)) {
      const backendRoot = process.cwd();
      templatePath = path.join(backendRoot, '..', 'email-templates', 'cart-abandonment.html');
    }
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Email template not found. Tried: ${templatePath}. Current dir: ${__dirname}, CWD: ${process.cwd()}`);
    }
    
    let template = fs.readFileSync(templatePath, 'utf8');

    template = template
      .replace('{{CUSTOMER_NAME}}', userData.first_name || 'Customer')
      .replace('{{CART_ITEMS}}', this.formatCartItems(cartItems));

    // Use noreply for cart abandonment (automated marketing)
    return this.sendEmail({
      to: userData.email,
      subject: 'Don\'t forget your items!',
      html: template,
    }, false); // false = use noreply email
  }

  // Investment email
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

  // Contact form email
  async sendContactEmail(contactData: any): Promise<{ success: boolean; error?: string }> {
    try {
      const { name, email, phone, subject, message } = contactData;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>New Contact Form Submission - VENTECH</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #FF7A19;">New Contact Form Submission</h2>
            
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Contact Details</h3>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
              <p><strong>Subject:</strong> ${subject}</p>
              <p><strong>Message:</strong></p>
              <div style="background-color: white; padding: 15px; border-radius: 4px; border-left: 4px solid #FF7A19;">
                ${message.replace(/\n/g, '<br>')}
              </div>
            </div>
            
            <p>This message was submitted through the VENTECH contact form.</p>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
              <p>VENTECH Gadgets - Your Trusted Tech Partner</p>
              <p>Email: ventechgadgets@gmail.com | Phone: +233 55 134 4310</p>
            </div>
          </div>
        </body>
        </html>
      `;

      // Use support email for contact form submissions (admin can reply)
      const success = await this.sendEmail({
        to: 'ventechgadgets@gmail.com',
        subject: `Contact Form: ${subject} - ${name}`,
        html: html,
      }, true); // true = use support email

      return { success };
    } catch (error) {
      console.error('Error sending contact email:', error);
      return { success: false, error: 'Failed to send contact email' };
    }
  }

  // Bulk order request email
  async sendBulkOrderEmail(bulkOrderData: any): Promise<{ success: boolean; error?: string }> {
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
      } = bulkOrderData;
      
      // Create plain text version for better deliverability
      const plainText = `
New Bulk Order Request - VENTECH

1. Contact Information
Name: ${name}
Phone: ${phone}
Email: ${email}
${organization ? `Organization: ${organization}` : ''}

2. Order Details
Product Type: ${productType}
Quantity: ${quantity}
${preferredSpecs ? `Preferred Specs: ${preferredSpecs}` : ''}

3. Delivery & Payment
Delivery Location: ${deliveryLocation}
Payment Method: ${paymentMethod}
${preferredDeliveryDate ? `Preferred Delivery Date: ${new Date(preferredDeliveryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}` : ''}

${notes ? `4. Additional Notes\n${notes}` : ''}

Action Required: Please contact the customer to confirm the order and provide pricing.

VENTECH Gadgets - Your Trusted Tech Partner
Email: ventechgadgets@gmail.com | Phone: +233 55 134 4310
This bulk order request was submitted through the VENTECH website.
      `.trim();

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Bulk Order Request - VENTECH</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5;">
          <div style="max-width: 700px; margin: 20px auto; padding: 20px; background-color: #ffffff;">
            <h2 style="color: #FF7A19; border-bottom: 3px solid #FF7A19; padding-bottom: 10px; margin-top: 0;">
              New Bulk Order Request
            </h2>
            
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1A1A1A;">1. Contact Information</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; width: 150px;">Name:</td>
                  <td style="padding: 8px 0;">${name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold;">Phone:</td>
                  <td style="padding: 8px 0;"><a href="tel:${phone.replace(/\s/g, '')}">${phone}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold;">Email:</td>
                  <td style="padding: 8px 0;"><a href="mailto:${email}">${email}</a></td>
                </tr>
                ${organization ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold;">Organization:</td>
                  <td style="padding: 8px 0;">${organization}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1A1A1A;">2. Order Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; width: 200px;">Product Type:</td>
                  <td style="padding: 8px 0;">${productType}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold;">Quantity:</td>
                  <td style="padding: 8px 0; font-size: 18px; color: #FF7A19; font-weight: bold;">${quantity}</td>
                </tr>
                ${preferredSpecs ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold;">Preferred Specs:</td>
                  <td style="padding: 8px 0;">${preferredSpecs.replace(/\n/g, '<br>')}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1A1A1A;">3. Delivery & Payment</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; width: 200px;">Delivery Location:</td>
                  <td style="padding: 8px 0;">${deliveryLocation}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold;">Payment Method:</td>
                  <td style="padding: 8px 0;">${paymentMethod}</td>
                </tr>
                ${preferredDeliveryDate ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold;">Preferred Delivery Date:</td>
                  <td style="padding: 8px 0;">${new Date(preferredDeliveryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            ${notes ? `
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1A1A1A;">4. Additional Notes</h3>
              <div style="background-color: white; padding: 15px; border-radius: 4px; border-left: 4px solid #FF7A19;">
                ${notes.replace(/\n/g, '<br>')}
              </div>
            </div>
            ` : ''}
            
            <div style="margin-top: 30px; padding: 20px; background-color: #fff3e0; border-radius: 8px; border-left: 4px solid #FF7A19;">
              <p style="margin: 0; font-weight: bold; color: #1A1A1A;">
                ⚡ Action Required: Please contact the customer to confirm the order and provide pricing.
              </p>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
              <p><strong>VENTECH Gadgets</strong> - Your Trusted Tech Partner</p>
              <p>Email: ventechgadgets@gmail.com | Phone: +233 55 134 4310</p>
              <p style="margin-top: 10px; font-style: italic;">This bulk order request was submitted through the VENTECH website.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      // Use support email for bulk order requests (admin can reply)
      // Remove emoji from subject to improve deliverability
      const subject = `Bulk Order Request: ${productType} (${quantity}) - ${name}`;
      
      const success = await this.sendEmail({
        to: 'ventechgadgets@gmail.com',
        subject: subject,
        html: html,
        // Note: Resend doesn't support plain text in the current implementation,
        // but we can add it if needed via attachments or separate API call
      }, true); // true = use support email

      return { success };
    } catch (error) {
      console.error('Error sending bulk order email:', error);
      return { success: false, error: 'Failed to send bulk order email' };
    }
  }

  // Helper methods
  private formatAddress(address: any): string {
    if (typeof address === 'string') return address;
    return `${address.street}, ${address.city}, ${address.region} ${address.postal_code}`;
  }

  private formatOrderItems(items: any[]): string {
    return items.map(item => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">
          <img src="${item.product_image}" alt="${item.product_name}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;">
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.product_name}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">GHS ${item.unit_price.toFixed(2)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">GHS ${item.subtotal.toFixed(2)}</td>
      </tr>
    `).join('');
  }

  private formatWishlistItems(items: any[]): string {
    return items.map(item => `
      <div style="display: flex; align-items: center; padding: 15px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 10px;">
        <img src="${item.product.image_url}" alt="${item.product.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; margin-right: 15px;">
        <div>
          <h4 style="margin: 0 0 5px 0; color: #1A1A1A;">${item.product.name}</h4>
          <p style="margin: 0; color: #FF7A19; font-weight: bold;">GHS ${item.product.original_price.toFixed(2)}</p>
        </div>
      </div>
    `).join('');
  }

  private formatCartItems(items: any[]): string {
    return items.map(item => `
      <div style="display: flex; align-items: center; padding: 15px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 10px;">
        <img src="${item.image_url}" alt="${item.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; margin-right: 15px;">
        <div>
          <h4 style="margin: 0 0 5px 0; color: #1A1A1A;">${item.name}</h4>
          <p style="margin: 0; color: #FF7A19; font-weight: bold;">GHS ${(item.discount_price || item.original_price).toFixed(2)}</p>
        </div>
      </div>
    `).join('');
  }

  private getStatusMessage(status: string): string {
    const messages: { [key: string]: string } = {
      'processing': 'Your order is being prepared for shipment.',
      'shipped': 'Your order has been shipped and is on its way!',
      'delivered': 'Your order has been delivered successfully.',
      'cancelled': 'Your order has been cancelled.',
    };
    return messages[status] || 'Your order status has been updated.';
  }

  // Affiliate application email
  async sendAffiliateApplicationEmail(affiliateData: any): Promise<{ success: boolean; error?: string }> {
    try {
      // Try multiple path resolutions for reliability
      let templatePath = path.join(__dirname, '../../email-templates/affiliate-application.html');
      
      // If not found, try from backend root (current working directory)
      if (!fs.existsSync(templatePath)) {
        const backendRoot = process.cwd();
        templatePath = path.join(backendRoot, 'email-templates', 'affiliate-application.html');
      }
      
      // If still not found, try from project root (one level up from backend)
      if (!fs.existsSync(templatePath)) {
        const backendRoot = process.cwd();
        templatePath = path.join(backendRoot, '..', 'email-templates', 'affiliate-application.html');
      }
      
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Email template not found. Tried: ${templatePath}. Current dir: ${__dirname}, CWD: ${process.cwd()}`);
      }

      let template = fs.readFileSync(templatePath, 'utf8');

      // Handle conditional sections first
      // Remove sections if optional fields are empty
      if (!affiliateData.audienceSize) {
        template = template.replace(/{{#AUDIENCE_SIZE}}[\s\S]*?{{\/AUDIENCE_SIZE}}/g, '');
      } else {
        template = template.replace(/{{#AUDIENCE_SIZE}}/g, '').replace(/{{\/AUDIENCE_SIZE}}/g, '');
      }

      if (!affiliateData.payoutMethod) {
        template = template.replace(/{{#PAYOUT_METHOD}}[\s\S]*?{{\/PAYOUT_METHOD}}/g, '');
      } else {
        template = template.replace(/{{#PAYOUT_METHOD}}/g, '').replace(/{{\/PAYOUT_METHOD}}/g, '');
      }

      if (!affiliateData.reason) {
        template = template.replace(/{{#REASON}}[\s\S]*?{{\/REASON}}/g, '');
      } else {
        template = template.replace(/{{#REASON}}/g, '').replace(/{{\/REASON}}/g, '');
      }

      // Replace placeholders
      template = template
        .replace(/{{FULL_NAME}}/g, affiliateData.fullName || 'N/A')
        .replace(/{{EMAIL}}/g, affiliateData.email || 'N/A')
        .replace(/{{PHONE}}/g, affiliateData.phone || 'N/A')
        .replace(/{{COUNTRY}}/g, affiliateData.country || 'N/A')
        .replace(/{{PROMOTION_CHANNEL}}/g, affiliateData.promotionChannel || 'N/A')
        .replace(/{{PLATFORM_LINK}}/g, affiliateData.platformLink || 'N/A')
        .replace(/{{AUDIENCE_SIZE}}/g, affiliateData.audienceSize || 'Not specified')
        .replace(/{{PAYOUT_METHOD}}/g, affiliateData.payoutMethod || 'Not specified')
        .replace(/{{REASON}}/g, affiliateData.reason ? affiliateData.reason.replace(/\n/g, '<br>') : 'Not provided');

      // Use support email for affiliate applications (admin can reply)
      const success = await this.sendEmail({
        to: 'ventechgadgets@gmail.com',
        subject: `New Affiliate Application: ${affiliateData.fullName} - ${affiliateData.promotionChannel}`,
        html: template,
      }, true); // true = use support email

      return { success };
    } catch (error) {
      console.error('Error sending affiliate application email:', error);
      return { success: false, error: 'Failed to send affiliate application email' };
    }
  }
}

const emailService = new EmailService();

// Export individual functions for specific use cases
export const sendInvestmentEmail = emailService.sendInvestmentEmail.bind(emailService);
export const sendContactEmail = emailService.sendContactEmail.bind(emailService);
export const sendBulkOrderEmail = emailService.sendBulkOrderEmail.bind(emailService);
export const sendAffiliateApplicationEmail = emailService.sendAffiliateApplicationEmail.bind(emailService);

export default emailService;