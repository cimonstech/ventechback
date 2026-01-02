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
import couponRoutes from './routes/coupon.routes';
import { errorHandler, notFound } from './middleware/error.middleware';
import { publicRateLimiter } from './middleware/rateLimit.middleware';

const app: Application = express();

// Trust proxy - Required for rate limiting behind reverse proxy (nginx, load balancer, etc.)
// This allows Express to correctly identify client IPs from X-Forwarded-For headers
app.set('trust proxy', true);

// Middleware
const allowedOrigins: string[] = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

const corsOptions: CorsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all origins in development
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
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
app.use('/api/coupons', publicRateLimiter, couponRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

export default app;
