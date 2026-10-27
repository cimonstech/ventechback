require('dotenv').config(); // ensure PM2 reads .env at runtime

module.exports = {
  apps: [
    {
      name: "ventech-backend",
      script: "dist/index.js",
      cwd: "/var/www/ventech/backend", // path to your backend root
      watch: false, // set to true if you want auto-restart on code changes
      env: {
        NODE_ENV: "development",
        PORT: process.env.PORT || 5000,
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        JWT_SECRET: process.env.JWT_SECRET,
        FRONTEND_URL: process.env.FRONTEND_URL,
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        RESEND_SUPPORT_EMAIL: process.env.RESEND_SUPPORT_EMAIL,
        RESEND_NOREPLY_EMAIL: process.env.RESEND_NOREPLY_EMAIL,
        ADMIN_NOTIFICATION_EMAIL: process.env.ADMIN_NOTIFICATION_EMAIL,
        EMAIL_SUBJECT_PREFIX: process.env.EMAIL_SUBJECT_PREFIX,
        FRONTEND_REVALIDATE_URL: process.env.FRONTEND_REVALIDATE_URL,
        REVALIDATE_SECRET: process.env.REVALIDATE_SECRET,
        SMTP_HOST: process.env.SMTP_HOST,
        SMTP_PORT: process.env.SMTP_PORT,
        SMTP_SECURE: process.env.SMTP_SECURE,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASS: process.env.SMTP_PASS,
        SMTP_FROM: process.env.SMTP_FROM,
        R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
        R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
        R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
        R2_PRIVATE_BUCKET_NAME: process.env.R2_PRIVATE_BUCKET_NAME,
        R2_PRIVATE_ACCESS_KEY_ID: process.env.R2_PRIVATE_ACCESS_KEY_ID,
        R2_PRIVATE_SECRET_ACCESS_KEY: process.env.R2_PRIVATE_SECRET_ACCESS_KEY,
        PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
        PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY,
        AFFILIATE_IP_SALT: process.env.AFFILIATE_IP_SALT
      },
      env_production: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 5000,
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        JWT_SECRET: process.env.JWT_SECRET,
        FRONTEND_URL: process.env.FRONTEND_URL,
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        RESEND_SUPPORT_EMAIL: process.env.RESEND_SUPPORT_EMAIL,
        RESEND_NOREPLY_EMAIL: process.env.RESEND_NOREPLY_EMAIL,
        ADMIN_NOTIFICATION_EMAIL: process.env.ADMIN_NOTIFICATION_EMAIL,
        EMAIL_SUBJECT_PREFIX: process.env.EMAIL_SUBJECT_PREFIX,
        FRONTEND_REVALIDATE_URL: process.env.FRONTEND_REVALIDATE_URL,
        REVALIDATE_SECRET: process.env.REVALIDATE_SECRET,
        SMTP_HOST: process.env.SMTP_HOST,
        SMTP_PORT: process.env.SMTP_PORT,
        SMTP_SECURE: process.env.SMTP_SECURE,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASS: process.env.SMTP_PASS,
        SMTP_FROM: process.env.SMTP_FROM,
        R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
        R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
        R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
        R2_PRIVATE_BUCKET_NAME: process.env.R2_PRIVATE_BUCKET_NAME,
        R2_PRIVATE_ACCESS_KEY_ID: process.env.R2_PRIVATE_ACCESS_KEY_ID,
        R2_PRIVATE_SECRET_ACCESS_KEY: process.env.R2_PRIVATE_SECRET_ACCESS_KEY,
        PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
        PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY,
        AFFILIATE_IP_SALT: process.env.AFFILIATE_IP_SALT
      }
    }
  ]
};
