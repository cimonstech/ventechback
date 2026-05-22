import dotenv from 'dotenv';

dotenv.config();

const getRequiredEnv = (key: string): string => {
  const value = process.env[key];

  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value.trim();
};

const getOptionalEnv = (key: string): string | null => {
  const value = process.env[key];
  return value && value.trim() !== '' ? value.trim() : null;
};

export const port = Number(getOptionalEnv('PORT') || '5000');
export const supabaseUrl = getRequiredEnv('SUPABASE_URL');
export const supabaseServiceKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');

const jwtSecretValue = getOptionalEnv('JWT_SECRET') || getOptionalEnv('SUPABASE_JWT_SECRET');
if (!jwtSecretValue) {
  throw new Error('Missing required environment variable: JWT_SECRET');
}

export const jwtSecret = jwtSecretValue;

export const resendApiKey = getOptionalEnv('RESEND_API_KEY');
export const resendSupportEmail = getOptionalEnv('RESEND_SUPPORT_EMAIL');
export const resendNoReplyEmail = getOptionalEnv('RESEND_NOREPLY_EMAIL');
export const supabasePublicUrl = getOptionalEnv('NEXT_PUBLIC_SUPABASE_URL') || supabaseUrl;

if (!resendApiKey) {
  console.warn('⚠️ RESEND_API_KEY is not set. Email sending is disabled.');
}

if (!resendSupportEmail) {
  console.warn('⚠️ RESEND_SUPPORT_EMAIL is not set. A default sender address will be used.');
}

if (!resendNoReplyEmail) {
  console.warn('⚠️ RESEND_NOREPLY_EMAIL is not set. A default noreply sender address will be used.');
}

const frontendUrlValue = getOptionalEnv('FRONTEND_URL');
export const frontendUrl = frontendUrlValue || 'https://ventechgadgets.com';
export const frontendUrls = frontendUrlValue
  ? frontendUrlValue.split(',').map(url => url.trim()).filter(Boolean)
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];
