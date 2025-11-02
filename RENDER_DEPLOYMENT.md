# 🚀 Render Deployment Guide for VENTECH Backend

This guide will help you deploy your VENTECH backend API to Render.

## Prerequisites

1. A Render account ([render.com](https://render.com))
2. Your backend repository pushed to GitHub
3. All environment variables from your `.env` file

## Deployment Steps

### Option 1: Using render.yaml (Recommended)

1. **Push the render.yaml file to GitHub** (if you haven't already)
   ```bash
   git add render.yaml
   git commit -m "Add Render deployment configuration"
   git push origin main
   ```

2. **Go to Render Dashboard**
   - Visit [dashboard.render.com](https://dashboard.render.com)
   - Click "New +" → "Blueprint"

3. **Connect Your Repository**
   - Select your GitHub repository
   - Render will automatically detect the `render.yaml` file
   - Review the configuration and click "Apply"

4. **Set Environment Variables**
   - Go to your service → Environment
   - Add all the environment variables from the list below
   - **Important**: Update `FRONTEND_URL` to your Vercel frontend URL (e.g., `https://your-app.vercel.app`)

5. **Deploy**
   - Render will automatically build and deploy your service
   - Wait for the deployment to complete

### Option 2: Manual Setup

1. **Go to Render Dashboard**
   - Visit [dashboard.render.com](https://dashboard.render.com)
   - Click "New +" → "Web Service"

2. **Connect Your Repository**
   - Select your GitHub repository
   - Choose the repository and branch

3. **Configure the Service**
   - **Name**: `ventech-backend` (or your preferred name)
   - **Region**: Choose closest to your users (e.g., Oregon)
   - **Branch**: `main`
   - **Root Directory**: `backend` (if your backend is in a subfolder) or leave blank
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Starter (or upgrade as needed)

4. **Set Environment Variables**
   - Go to Environment section
   - Add each variable from the list below

5. **Deploy**
   - Click "Create Web Service"
   - Render will build and deploy your service

## Required Environment Variables

Copy these from your `.env` file and set them in Render:

```env
NODE_ENV=production
PORT=5000

# Frontend URL (UPDATE THIS to your Vercel URL)
FRONTEND_URL=https://your-app.vercel.app

# Supabase Configuration
SUPABASE_URL=https://ibrokmmepywrrgakoleh.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# JWT Secret
JWT_SECRET=your_jwt_secret

# Email Configuration
EMAIL_USER=ventechgadgets@gmail.com
EMAIL_PASSWORD=your_email_password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=ventechgadgets@gmail.com
SMTP_PASS=your_smtp_password
SMTP_FROM="VENTECH <ventechgadgets@gmail.com>"

# Cloudflare R2 Storage
R2_ACCOUNT_ID=your_r2_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=ventech-images
R2_PUBLIC_URL=https://files.ventechgadgets.com

# Payment Gateway
PAYSTACK_SECRET_KEY=your_paystack_secret_key
PAYSTACK_PUBLIC_KEY=your_paystack_public_key
```

## Important Notes

1. **FRONTEND_URL**: Update this to your actual Vercel frontend URL after deployment
   - Format: `https://your-app.vercel.app`
   - This is used for CORS configuration

2. **Security**: Never commit your `.env` file to GitHub
   - The `render.yaml` has `sync: false` to prevent auto-syncing sensitive values
   - Always set environment variables manually in Render dashboard

3. **Health Check**: Your backend has a health check endpoint at `/health`
   - Render will automatically use this for service health monitoring

4. **Build Process**: 
   - Render runs `npm install && npm run build` to compile TypeScript
   - Then runs `npm start` which executes `node dist/index.js`

5. **Auto-Deploy**: 
   - Render automatically deploys on every push to your main branch
   - You can disable this in the service settings if needed

## Updating Your Frontend

After deploying to Render, update your frontend environment variables:

```env
NEXT_PUBLIC_API_URL=https://ventech-backend.onrender.com
```

Or if you set up a custom domain:

```env
NEXT_PUBLIC_API_URL=https://api.ventechgadgets.com
```

## Custom Domain (Optional)

1. Go to your service → Settings → Custom Domain
2. Add your domain (e.g., `api.ventechgadgets.com`)
3. Update DNS records as instructed by Render
4. Update `FRONTEND_URL` and `NEXT_PUBLIC_API_URL` accordingly

## Troubleshooting

- **Build fails**: Check the build logs in Render dashboard
- **Service won't start**: Verify all environment variables are set correctly
- **CORS errors**: Ensure `FRONTEND_URL` matches your actual frontend URL
- **Health check fails**: Verify the service is running and accessible

## Support

For issues, check:
- Render logs in the dashboard
- Build logs for compilation errors
- Environment variables are all set correctly

