process.env.NODE_ENV = 'test';
if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = 'https://example.invalid';
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
if (!process.env.RESEND_API_KEY) process.env.RESEND_API_KEY = 're_test_key';
if (!process.env.PAYSTACK_SECRET_KEY) process.env.PAYSTACK_SECRET_KEY = 'sk_test_key';
if (!process.env.FRONTEND_URL) process.env.FRONTEND_URL = 'http://localhost:3000';

export type TestEmailCall = {
  to?: string;
  subject?: string;
  html?: string;
  useSupportEmail?: boolean;
};

export const testEmailCalls: TestEmailCall[] = [];

function stubSendEmail(service: { sendEmail: (...args: any[]) => Promise<boolean> }) {
  service.sendEmail = async (options: any = {}, useSupportEmail?: boolean) => {
    testEmailCalls.push({
      to: options.to,
      subject: options.subject,
      html: options.html,
      useSupportEmail,
    });
    return true;
  };
}

// require() after env is set. import would be hoisted and construct Resend first.
const enhancedEmailService = require('./services/enhanced-email.service').default;
const { emailService } = require('./services/email.service');
stubSendEmail(enhancedEmailService);
stubSendEmail(emailService);
