import { Resend } from 'resend';
import { adminNotificationEmail, emailSubject } from '../config/email';
import {
  adminNewAffiliate,
  affiliateApplicationAdmin,
  affiliateApproved,
  affiliateCommissionPending,
  affiliateCommissionReversed,
  affiliateFeeReceived,
  affiliatePayoutChanged,
  affiliateRejected,
  affiliateWithdrawalPaid,
  affiliateWithdrawalRejected,
  affiliateWithdrawalRequested,
  bulkOrderAdmin,
  bulkOrderCustomer,
  cartAbandonment,
  contactAdmin,
  contactCustomer,
  finalizeRenderedEmail,
  orderCancelled,
  orderConfirmation,
  orderStatusUpdate,
  sanitizeEmailOutput,
  vlbNewInvestmentAdmin,
  wishlistReminder,
  type RenderedEmail,
} from '../emails';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
  /** When set, footer contact is loaded from store settings before send. */
  rendered?: RenderedEmail;
}

async function payload(rendered: RenderedEmail): Promise<Pick<EmailOptions, 'subject' | 'html' | 'text' | 'rendered'>> {
  return {
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    rendered,
  };
}

class EmailService {
  private resend: Resend;
  private supportEmail: string;
  private noreplyEmail: string;

  constructor() {
    const resendApiKey = process.env.RESEND_API_KEY;

    if (!resendApiKey) {
      console.error('RESEND_API_KEY is missing in .env file');
      throw new Error('RESEND_API_KEY is required');
    }

    this.resend = new Resend(resendApiKey);

    this.supportEmail = process.env.RESEND_SUPPORT_EMAIL || 'VENTECH GADGETS <support@ventechgadgets.com>';
    this.noreplyEmail = process.env.RESEND_NOREPLY_EMAIL || 'VENTECH GADGETS <noreply@ventechgadgets.com>';

    console.log('Resend email service initialized');
    console.log(`   Support Email: ${this.supportEmail}`);
    console.log(`   No-Reply Email: ${this.noreplyEmail}`);
  }

  async sendEmail(options: EmailOptions, useSupportEmail: boolean = true): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }

    try {
      const attachments = options.attachments?.map((att) => ({
        filename: att.filename,
        content: att.content.toString('base64'),
      })) || [];

      const prepared = options.rendered ? await finalizeRenderedEmail(options.rendered) : options;
      const fromEmail = useSupportEmail ? this.supportEmail : this.noreplyEmail;
      const subject = emailSubject(prepared.subject);
      const html = sanitizeEmailOutput(prepared.html, 'html');
      const text = prepared.text ? sanitizeEmailOutput(prepared.text, 'text') : undefined;

      const { data, error } = await this.resend.emails.send({
        from: fromEmail,
        to: options.to,
        subject,
        html,
        text,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (error) {
        console.error('Error sending email via Resend:', {
          error,
          message: (error as any)?.message || 'Unknown error',
          code: (error as any)?.code,
          details: (error as any)?.details,
          to: options.to,
          from: fromEmail,
          subject,
        });
        return false;
      }

      console.log(`Email sent via Resend [${useSupportEmail ? 'Support' : 'No-Reply'}]:`, data?.id);
      return true;
    } catch (error) {
      console.error('Error sending email:', error);
      return false;
    }
  }

  async sendOrderConfirmation(orderData: any): Promise<boolean> {
    if (!orderData?.customer_email) return false;
    return this.sendEmail({
      to: orderData.customer_email,
      ...(await payload(orderConfirmation(orderData))),
    }, true);
  }

  async sendOrderStatusUpdate(orderData: any, newStatus: string): Promise<boolean> {
    if (!orderData?.customer_email) return false;
    return this.sendEmail({
      to: orderData.customer_email,
      ...(await payload(orderStatusUpdate(orderData, newStatus))),
    }, true);
  }

  async sendOrderCancellation(orderData: any): Promise<boolean> {
    if (!orderData?.customer_email) return false;
    return this.sendEmail({
      to: orderData.customer_email,
      ...(await payload(orderCancelled(orderData))),
    }, true);
  }

  async sendWishlistReminder(userData: any, wishlistItems: any[]): Promise<boolean> {
    const name = userData?.first_name || userData?.full_name || userData?.name || '';
    const items = (wishlistItems || []).map((item) => ({
      name: item.product?.name || item.product_name || item.name || 'Item',
      price: Number(item.product?.original_price ?? item.product_price ?? item.price ?? 0),
    }));
    return this.sendEmail({
      to: userData.email,
      ...(await payload(wishlistReminder({ firstName: name, items }))),
    }, false);
  }

  async sendCartAbandonmentReminder(userData: any, cartItems: any[]): Promise<boolean> {
    const name = userData?.first_name || userData?.full_name || userData?.name || userData?.customer_name || '';
    const items = (cartItems || []).map((item) => ({
      name: item.name || item.product_name || 'Item',
      quantity: Number(item.quantity || 1),
      price: Number(item.discount_price ?? item.original_price ?? item.price ?? 0),
    }));
    return this.sendEmail({
      to: userData.email,
      ...(await payload(cartAbandonment({ firstName: name, items }))),
    }, false);
  }

  async sendInvestmentEmail(investmentData: any): Promise<{ success: boolean; error?: string }> {
    try {
      const success = await this.sendEmail({
        to: adminNotificationEmail,
        ...(await payload(vlbNewInvestmentAdmin({
          fullName: investmentData.fullName,
          email: investmentData.email,
          phone: investmentData.phone,
          tier: investmentData.tier,
          amount: investmentData.amount,
          plan: investmentData.plan,
          message: investmentData.message,
        }))),
      }, true);
      return { success };
    } catch (error) {
      console.error('Error sending investment email:', error);
      return { success: false, error: 'Failed to send investment email' };
    }
  }

  async sendContactEmail(contactData: any): Promise<{ success: boolean; error?: string }> {
    try {
      const adminOk = await this.sendEmail({
        to: adminNotificationEmail,
        ...(await payload(contactAdmin(contactData))),
      }, true);
      const customerOk = await this.sendEmail({
        to: contactData.email,
        ...(await payload(contactCustomer({
          firstName: contactData.name,
          subject: contactData.subject,
        }))),
      }, true);
      return { success: adminOk && customerOk };
    } catch (error) {
      console.error('Error sending contact email:', error);
      return { success: false, error: 'Failed to send contact email' };
    }
  }

  async sendBulkOrderEmail(bulkOrderData: any): Promise<{ success: boolean; error?: string }> {
    try {
      const adminOk = await this.sendEmail({
        to: adminNotificationEmail,
        ...(await payload(bulkOrderAdmin(bulkOrderData))),
      }, true);
      const customerOk = await this.sendEmail({
        to: bulkOrderData.email,
        ...(await payload(bulkOrderCustomer({
          firstName: bulkOrderData.name,
          productType: bulkOrderData.productType,
          quantity: bulkOrderData.quantity,
        }))),
      }, true);
      return { success: adminOk && customerOk };
    } catch (error) {
      console.error('Error sending bulk order email:', error);
      return { success: false, error: 'Failed to send bulk order email' };
    }
  }

  async sendAffiliateApplicationEmail(affiliateData: any): Promise<{ success: boolean; error?: string }> {
    try {
      const success = await this.sendEmail({
        to: adminNotificationEmail,
        ...(await payload(affiliateApplicationAdmin(affiliateData))),
      }, true);
      return { success };
    } catch (error) {
      console.error('Error sending affiliate application email:', error);
      return { success: false, error: 'Failed to send affiliate application email' };
    }
  }
}

export const emailService = new EmailService();

export const sendInvestmentEmail = emailService.sendInvestmentEmail.bind(emailService);
export const sendContactEmail = emailService.sendContactEmail.bind(emailService);
export const sendBulkOrderEmail = emailService.sendBulkOrderEmail.bind(emailService);
export const sendAffiliateApplicationEmail = emailService.sendAffiliateApplicationEmail.bind(emailService);

export {
  affiliateFeeReceived,
  adminNewAffiliate,
  affiliateApproved,
  affiliateRejected,
  affiliatePayoutChanged,
  affiliateWithdrawalRequested,
  affiliateWithdrawalPaid,
  affiliateWithdrawalRejected,
  affiliateCommissionPending,
  affiliateCommissionReversed,
};
