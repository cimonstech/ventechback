import dotenv from 'dotenv';
dotenv.config();

import express, { Application, Request, Response } from 'express';
import cors, { CorsOptions } from 'cors';

import productRoutes from './routes/product.routes';
import orderRoutes from './routes/order.routes';
import paymentRoutes from './routes/payment.routes';
import transactionRoutes from './routes/transaction.routes';
import bannerRoutes from './routes/banner.routes';
import investmentRoutes from './routes/investment.routes';
import uploadRoutes from './routes/upload.routes';
import contactRoutes from './routes/contact.routes';
import bulkOrderRoutes from './routes/bulkOrder.routes';
import affiliateRoutes from './routes/affiliate.routes';
import affiliatesRoutes from './routes/affiliates.routes';
import refRoutes from './routes/ref.routes';
import couponRoutes from './routes/coupon.routes';
import auditRoutes from './routes/audit.routes';
import staffRoutes from './routes/staff.routes';
import accessRoutes from './routes/access.routes';
import contentRoutes from './routes/content.routes';
import adminContentRoutes from './routes/adminContent.routes';
import devicesRoutes from './routes/devices.routes';
import adminDevicesRoutes from './routes/adminDevices.routes';
import ticketsRoutes from './routes/tickets.routes';
import adminTicketsRoutes from './routes/adminTickets.routes';
import { errorHandler, notFound } from './middleware/error.middleware';
import { publicRateLimiter } from './middleware/rateLimit.middleware';

const app: Application = express();

// Trust proxy - Required for rate limiting behind reverse proxy (nginx, load balancer, etc.)
// This allows Express to correctly identify client IPs from X-Forwarded-For headers
// Set to 1 to trust only the first proxy (nginx) - more secure for rate limiting
// In production behind nginx, we trust only the first hop (nginx itself)
app.set('trust proxy', 1);

// Middleware
const allowedOrigins: string[] = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((url) => url.trim())
  .filter((url) => url.length > 0);

if (process.env.NODE_ENV !== 'production') {
  for (const localOrigin of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
    if (!allowedOrigins.includes(localOrigin)) {
      allowedOrigins.push(localOrigin);
    }
  }
}

const rejectedOrigins = new Set<string>();

const corsOptions: CorsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (server-to-server, Paystack webhooks, curl)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    if (!rejectedOrigins.has(origin)) {
      rejectedOrigins.add(origin);
      console.warn(`CORS rejected origin: ${origin}`);
    }
    return callback(null, false);
  },
  credentials: true,
};

app.use(cors(corsOptions));

// Paystack signs the raw bytes. This path must stay a Buffer.
// body-parser sets req._body, so the global express.json() below skips it.
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'VENTECH API is running' });
});

// API Routes with rate limiting
// Note: Individual routes have specific rate limiters applied
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/banners', publicRateLimiter, bannerRoutes);
app.use('/api/investment', publicRateLimiter, investmentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/bulk-orders', bulkOrderRoutes);
app.use('/api/affiliate', publicRateLimiter, affiliateRoutes);
app.use('/api/affiliates', affiliatesRoutes);
app.use('/api/ref', refRoutes);
app.use('/api/coupons', publicRateLimiter, couponRoutes);
app.use('/api/content', publicRateLimiter, contentRoutes);
app.use('/api/admin/content', adminContentRoutes);
app.use('/api/devices', publicRateLimiter, devicesRoutes);
app.use('/api/admin/devices', adminDevicesRoutes);
app.use('/api/tickets', publicRateLimiter, ticketsRoutes);
app.use('/api/admin/tickets', adminTicketsRoutes);
app.use('/api/admin/audit-log', auditRoutes);
app.use('/api/admin/staff', staffRoutes);
app.use('/api/me', accessRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

export default app;
