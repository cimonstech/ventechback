// src/types/affiliate.types.ts

export interface Affiliate {
  id: string;
  userId: string;
  referralCode: string;
  tier: 'starter' | 'pro' | 'elite';
  status: 'pending' | 'active' | 'suspended';
  totalEarnings: number;
  pendingEarnings: number;
  totalClicks: number;
  totalConversions: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReferralLink {
  id: string;
  affiliateId: string;
  name: string;
  url: string;
  shortUrl: string;
  source?: string;
  clicks: number;
  conversions: number;
  earnings: number;
  createdAt: string;
  updatedAt: string;
}

export interface AffiliateLink {
  id: string;
  affiliateId: string;
  productId: string;
  referralCode: string;
  generatedUrl: string;
  clicks: number;
  conversions: number;
  createdAt: string;
  updatedAt: string;
}

export interface Earning {
  id: string;
  affiliateId: string;
  orderId: string;
  productId: string;
  productName: string;
  amount: number;
  status: 'pending' | 'approved' | 'paid';
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payout {
  id: string;
  affiliateId: string;
  amount: number;
  method: 'bank' | 'momo' | 'crypto';
  status: 'pending' | 'processing' | 'completed';
  reference?: string;
  processedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentMethod {
  id: string;
  affiliateId: string;
  type: 'bank' | 'momo' | 'crypto';
  name: string;
  details: string;
  isDefault: boolean;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClickLog {
  id: string;
  referralCode: string;
  ip: string;
  userAgent: string;
  source: string;
  converted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AffiliateClick {
  id: string;
  affiliateId: string;
  referralCode: string;
  ip: string;
  userAgent: string;
  source: string;
  landingPage?: string;
  converted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommissionRates {
  starter: number;
  pro: number;
  elite: number;
}

export interface DashboardStats {
  totalEarnings: number;
  pendingEarnings: number;
  totalClicks: number;
  totalConversions: number;
  conversionRate: string;
  thisMonthEarnings: number;
  lastMonthEarnings: number;
  tier: string;
  referralCode: string;
}

export interface ChartData {
  labels: string[];
  earnings: number[];
  clicks: number[];
  conversions: number[];
  isEmpty?: boolean;
  dataType?: 'real' | 'empty';
  message?: string;
}

export interface ProductWithCommission {
  id: string;
  name: string;
  price: number;
  description?: string;
  category?: string;
  image?: string;
  commissionRate: number;
  commission: number;
}

export interface UserProfile {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  avatar?: string;
  bio?: string;
  country?: string;
  city?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'inactive' | 'upcoming';
  startDate: string;
  endDate: string;
  commissionBonus: number;
  imageUrl?: string;
  products?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AffiliateSettings {
  id: string;
  affiliateId: string;
  emailNotifications: boolean;
  monthlyReports: boolean;
  autoWithdrawal: boolean;
  autoWithdrawalAmount?: number;
  createdAt: string;
  updatedAt: string;
}