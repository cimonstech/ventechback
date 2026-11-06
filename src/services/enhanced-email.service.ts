import { Resend } from 'resend';
import { adminNotificationEmail, emailSubject } from '../config/email';
import {
  adminNewOrder,
  cartAbandonment,
  finalizeRenderedEmail,
  newsletter,
  orderCancelled,
  orderConfirmation,
  orderPaymentProblem,
  orderStatusUpdate,
  sanitizeEmailOutput,
  vlbNewInvestmentAdmin,
  wishlistReminder,
  type RenderedEmail,
} from '../emails';
import { supabaseAdmin } from '../utils/supabaseClient';
import { settingsService } from './settings.service';

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
  rendered?: RenderedEmail;
}

interface UserPreferences {
  email_notifications: boolean;
  newsletter_subscribed: boolean;
  sms_notifications: boolean;
}

async function payload(rendered: RenderedEmail): Promise<Pick<EmailOptions, 'subject' | 'html' | 'text' | 'rendered'>> {
  return {
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    rendered,
  };
}

class EnhancedEmailService {
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

  private async getUserPreferences(userId: string): Promise<UserPreferences> {
    try {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('email_notifications, newsletter_subscribed, sms_notifications')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('Error fetching user preferences:', error);
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

  private async shouldSendEmail(userId: string, emailType: 'transactional' | 'newsletter' | 'marketing'): Promise<boolean> {
    const preferences = await this.getUserPreferences(userId);
    switch (emailType) {
      case 'transactional':
        return preferences.email_notifications;
      case 'newsletter':
      case 'marketing':
        return preferences.newsletter_subscribed;
      default:
        return true;
    }
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
          subject,
          from: fromEmail,
        });
        return false;
      }

      console.log(`Email sent via Resend [${useSupportEmail ? 'Support' : 'No-Reply'}] to ${options.to}:`, data?.id);
      return true;
    } catch (error) {
      console.error('Error sending email:', error);
      return false;
    }
  }

  async sendOrderConfirmation(orderData: any): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      if (!orderData.customer_email) {
        console.error('No customer email provided for order confirmation:', orderData.order_number);
        return { success: false, reason: 'No customer email provided' };
      }
      const success = await this.sendEmail({
        to: orderData.customer_email,
        ...(await payload(orderConfirmation(orderData))),
      }, true);
      return { success };
    } catch (error) {
      console.error('Error sending order confirmation:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async sendOrderStatusUpdate(orderData: any, newStatus: string): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      if (!orderData.customer_email) {
        console.error('No customer email provided for order status update:', orderData.order_number);
        return { success: false, reason: 'No customer email provided' };
      }
      const success = await this.sendEmail({
        to: orderData.customer_email,
        ...(await payload(orderStatusUpdate(orderData, newStatus))),
      }, true);
      return { success };
    } catch (error) {
      console.error('Error sending order status update:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async sendOrderCancellation(orderData: any): Promise<{ success: boolean; reason?: string }> {
    try {
      if (!orderData.customer_email) {
        return { success: false, reason: 'No customer email provided' };
      }
      const success = await this.sendEmail({
        to: orderData.customer_email,
        ...(await payload(orderCancelled(orderData))),
      }, true);
      return { success };
    } catch (error) {
      console.error('Error sending order cancellation email:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async sendPaymentProblem(orderData: any): Promise<{ success: boolean; reason?: string }> {
    try {
      if (!orderData.customer_email) {
        return { success: false, reason: 'No customer email provided' };
      }
      const success = await this.sendEmail({
        to: orderData.customer_email,
        ...(await payload(orderPaymentProblem(orderData))),
      }, true);
      return { success };
    } catch (error) {
      console.error('Error sending payment problem email:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async sendAdminOrderNotification(orderData: any): Promise<{ success: boolean; reason?: string }> {
    try {
      const success = await this.sendEmail({
        to: adminNotificationEmail,
        ...(await payload(adminNewOrder(orderData))),
      }, true);
      return { success };
    } catch (error) {
      console.error('Error sending admin order notification:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async sendNewsletter(userId: string, subject: string, content: string): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      const emailNotificationsEnabled = await settingsService.isEnabled('email_notifications_enabled');
      if (!emailNotificationsEnabled) {
        return { success: true, skipped: true, reason: 'Email notifications disabled in settings' };
      }
      const shouldSend = await this.shouldSendEmail(userId, 'newsletter');
      if (!shouldSend) {
        return { success: true, skipped: true, reason: 'User has unsubscribed from newsletter' };
      }
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('email, first_name, last_name, full_name')
        .eq('id', userId)
        .single();
      if (error || !user) {
        return { success: false, reason: 'User not found' };
      }
      const name = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ');
      const success = await this.sendEmail({
        to: user.email,
        ...(await payload(newsletter({ firstName: name, subject, htmlContent: content }))),
      }, false);
      return { success };
    } catch (error) {
      console.error('Error sending newsletter:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async sendWishlistReminder(userId: string, wishlistItems: any[]): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      const emailNotificationsEnabled = await settingsService.isEnabled('email_notifications_enabled');
      if (!emailNotificationsEnabled) {
        return { success: true, skipped: true, reason: 'Email notifications disabled in settings' };
      }
      const wishlistRemindersEnabled = await settingsService.isEnabled('email_wishlist_reminders');
      if (!wishlistRemindersEnabled) {
        return { success: true, skipped: true, reason: 'Wishlist reminder emails are disabled in settings' };
      }
      const shouldSend = await this.shouldSendEmail(userId, 'marketing');
      if (!shouldSend) {
        return { success: true, skipped: true, reason: 'User has disabled email notifications' };
      }
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('email, first_name, last_name, full_name')
        .eq('id', userId)
        .single();
      if (error || !user) {
        return { success: false, reason: 'User not found' };
      }
      const name = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ');
      const items = (wishlistItems || []).map((item) => ({
        name: item.product_name || item.product?.name || 'Item',
        price: Number(item.product_price ?? item.product?.original_price ?? 0),
      }));
      const success = await this.sendEmail({
        to: user.email,
        ...(await payload(wishlistReminder({ firstName: name, items }))),
      }, false);
      return { success };
    } catch (error) {
      console.error('Error sending wishlist reminder:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async sendCartAbandonmentReminder(userId: string, cartItems: any[]): Promise<{ success: boolean; skipped?: boolean; reason?: string }> {
    try {
      const emailNotificationsEnabled = await settingsService.isEnabled('email_notifications_enabled');
      if (!emailNotificationsEnabled) {
        return { success: true, skipped: true, reason: 'Email notifications disabled in settings' };
      }
      const cartAbandonmentEnabled = await settingsService.isEnabled('email_cart_abandonment');
      if (!cartAbandonmentEnabled) {
        return { success: true, skipped: true, reason: 'Cart abandonment emails are disabled in settings' };
      }
      const shouldSend = await this.shouldSendEmail(userId, 'marketing');
      if (!shouldSend) {
        return { success: true, skipped: true, reason: 'User has disabled email notifications' };
      }
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('email, first_name, last_name, full_name')
        .eq('id', userId)
        .single();
      if (error || !user) {
        return { success: false, reason: 'User not found' };
      }
      const name = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ');
      const items = (cartItems || []).map((item) => ({
        name: item.product_name || item.name || 'Item',
        quantity: Number(item.quantity || 1),
        price: Number(item.price ?? item.discount_price ?? item.original_price ?? 0),
      }));
      const success = await this.sendEmail({
        to: user.email,
        ...(await payload(cartAbandonment({ firstName: name, items }))),
      }, false);
      return { success };
    } catch (error) {
      console.error('Error sending cart abandonment reminder:', error);
      return { success: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
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
}

export default new EnhancedEmailService();
