/**
 * affiliateClient.ts
 * Frontend API client for VENTECH Affiliate System
 * 
 * Usage in React:
 * const affiliateClient = new AffiliateClient(jwtToken);
 * const stats = await affiliateClient.getDashboardStats();
 */

interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT';
  body?: any;
}

interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class AffiliateClient {
  private baseUrl: string;
  private jwtToken: string;

  constructor(jwtToken: string, baseUrl: string = '/api/affiliate') {
    this.jwtToken = jwtToken;
    this.baseUrl = baseUrl;
  }

  /**
   * Internal method to make HTTP requests
   */
  private async request<T = any>(endpoint: string, options: RequestOptions): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.jwtToken) {
      headers['Authorization'] = `Bearer ${this.jwtToken}`;
    }

    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      throw new Error(errorData.message || `API Error: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  // ==================== PUBLIC ENDPOINTS ====================

  /**
   * Submit affiliate application (PUBLIC - no auth required)
   */
  async submitApplication(data: {
    fullName: string;
    email: string;
    phone: string;
    country: string;
    promotionChannel: string;
    platformLink: string;
    audienceSize: number;
    payoutMethod: string;
    reason: string;
  }): Promise<ApiResponse> {
    return this.request('/', {
      method: 'POST',
      body: data,
    });
  }

  // ==================== DASHBOARD ENDPOINTS ====================

  /**
   * Get dashboard statistics
   */
  async getDashboardStats(): Promise<ApiResponse<{
    totalEarnings: number;
    pendingEarnings: number;
    totalClicks: number;
    totalConversions: number;
    conversionRate: string;
    thisMonthEarnings: number;
    lastMonthEarnings: number;
    tier: string;
    referralCode: string;
  }>> {
    return this.request('/dashboard/stats', { method: 'GET' });
  }

  /**
   * Get chart data for dashboard visualization
   */
  async getChartData(): Promise<ApiResponse<{
    labels: string[];
    earnings: number[];
    clicks: number[];
    conversions: number[];
  }>> {
    return this.request('/dashboard/chart-data', { method: 'GET' });
  }

  /**
   * Get recent earnings (last 10)
   */
  async getRecentEarnings(): Promise<ApiResponse<any[]>> {
    return this.request('/dashboard/recent-earnings', { method: 'GET' });
  }

  // ==================== EARNINGS ENDPOINTS ====================

  /**
   * Get all earnings with pagination and filtering
   */
  async getEarnings(options?: {
    status?: 'all' | 'pending' | 'approved' | 'paid';
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<any[]>> {
    const params = new URLSearchParams();
    if (options?.status) params.append('status', options.status);
    if (options?.page) params.append('page', options.page.toString());
    if (options?.limit) params.append('limit', options.limit.toString());

    const query = params.toString();
    return this.request(`/earnings${query ? '?' + query : ''}`, { method: 'GET' });
  }

  /**
   * Get earnings summary (breakdown by status)
   */
  async getEarningsSummary(): Promise<ApiResponse<{
    approved: number;
    pending: number;
    paid: number;
  }>> {
    return this.request('/earnings/summary', { method: 'GET' });
  }

  // ==================== REFERRAL LINKS ENDPOINTS ====================

  /**
   * Get all referral links
   */
  async getReferralLinks(): Promise<ApiResponse<any[]>> {
    return this.request('/links', { method: 'GET' });
  }

  /**
   * Create a new referral link
   */
  async createReferralLink(data: {
    name: string;
    source: string;
  }): Promise<ApiResponse<{
    id: string;
    name: string;
    url: string;
    shortUrl: string;
    source: string;
    createdAt: string;
  }>> {
    return this.request('/links', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Generate a product affiliate link
   */
  async generateProductAffiliateLink(data: {
    productId?: string;
    product_id?: string;
  }): Promise<ApiResponse<{
    id: string;
    generated_url: string;
    generatedUrl: string;
    referral_code: string;
    referralCode: string;
    product_id: string;
    productId: string;
    clicks: number;
    conversions: number;
    created_at: string;
    createdAt: string;
  }>> {
    return this.request('/links/generate', {
      method: 'POST',
      body: {
        productId: data.productId ?? data.product_id,
      },
    });
  }

  /**
   * Get generated product affiliate links
   */
  async getProductAffiliateLinks(): Promise<ApiResponse<any[]>> {
    return this.request('/links/product', { method: 'GET' });
  }

  /**
   * Delete a referral link
   */
  async deleteReferralLink(linkId: string): Promise<ApiResponse> {
    return this.request(`/links/${linkId}`, { method: 'DELETE' });
  }

  // ==================== PRODUCTS ENDPOINTS ====================

  /**
   * Get all products with affiliate commission info
   */
  async getProducts(): Promise<ApiResponse<any[]>> {
    return this.request('/products', { method: 'GET' });
  }

  // ==================== PAYMENT METHODS ENDPOINTS ====================

  /**
   * Get all payment methods
   */
  async getPaymentMethods(): Promise<ApiResponse<any[]>> {
    return this.request('/payment-methods', { method: 'GET' });
  }

  /**
   * Add a new payment method
   */
  async addPaymentMethod(data: {
    type: 'bank' | 'momo' | 'crypto';
    name: string;
    details: string;
  }): Promise<ApiResponse<{
    id: string;
    type: string;
    name: string;
    details: string;
    isDefault: boolean;
    isVerified: boolean;
  }>> {
    return this.request('/payment-methods', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Delete a payment method
   */
  async deletePaymentMethod(methodId: string): Promise<ApiResponse> {
    return this.request(`/payment-methods/${methodId}`, { method: 'DELETE' });
  }

  // ==================== PAYOUTS ENDPOINTS ====================

  /**
   * Get payout history
   */
  async getPayouts(): Promise<ApiResponse<any[]>> {
    return this.request('/payouts', { method: 'GET' });
  }

  /**
   * Request a payout
   */
  async requestPayout(data: {
    amount: number;
    methodId: string;
  }): Promise<ApiResponse<{
    id: string;
    amount: number;
    method: string;
    status: 'pending' | 'processing' | 'completed';
    createdAt: string;
  }>> {
    return this.request('/payouts/request', {
      method: 'POST',
      body: data,
    });
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Update JWT token (when user logs in with new token)
   */
  updateToken(token: string): void {
    this.jwtToken = token;
  }

  /**
   * Clear JWT token (on logout)
   */
  clearToken(): void {
    this.jwtToken = '';
  }
}

// ==================== USAGE EXAMPLES ====================

/**
 * Example 1: React Hook for Dashboard
 * Note: This is frontend code - implement in your React app
 *
 * export const useDashboardData = (jwtToken: string) => {
 *   const [stats, setStats] = React.useState(null);
 *   const [chartData, setChartData] = React.useState(null);
 *   const [loading, setLoading] = React.useState(true);
 *   const [error, setError] = React.useState(null);
 *
 *   React.useEffect(() => {
 *     const fetchData = async () => {
 *       try {
 *         const client = new AffiliateClient(jwtToken);
 *         const [statsRes, chartRes] = await Promise.all([
 *           client.getDashboardStats(),
 *           client.getChartData(),
 *         ]);
 *
 *         setStats(statsRes.data);
 *         setChartData(chartRes.data);
 *       } catch (err: any) {
 *         setError(err.message);
 *       } finally {
 *         setLoading(false);
 *       }
 *     };
 *
 *     fetchData();
 *   }, [jwtToken]);
 *
 *   return { stats, chartData, loading, error };
 * };
 */

/**
 * Example 2: Basic usage
 *
 * const client = new AffiliateClient(jwtToken);
 * const stats = await client.getDashboardStats();
 * console.log('Total earnings:', stats.data.totalEarnings);
 */
