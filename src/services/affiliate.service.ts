// src/services/affiliate.service.ts

import { supabaseAdmin } from '../utils/supabaseClient';
import { frontendUrl } from '../config/env';
import {
  Affiliate,
  ReferralLink,
  AffiliateLink,
  Earning,
  Payout,
  PaymentMethod,
  DashboardStats,
  ChartData,
  CommissionRates,
} from '../types/affiliate.types';

export class AffiliateService {
  private COMMISSION_RATES: CommissionRates = {
    starter: 0.08,
    pro: 0.10,
    elite: 0.12,
  };

  private MIN_PAYOUT = 50;
  private COOKIE_DURATION_DAYS = 90;

  /**
   * Create a new affiliate account for a user
   */
  async createAffiliate(userId: string, tier: string = 'starter'): Promise<Affiliate> {
    // Generate unique referral code
    const referralCode = this.generateReferralCode();

    const { data, error } = await supabaseAdmin
      .from('affiliates')
      .insert({
        user_id: userId,
        referral_code: referralCode,
        tier,
        status: 'pending',
        total_earnings: 0,
        pending_earnings: 0,
        total_clicks: 0,
        total_conversions: 0,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create affiliate: ${error.message}`);
    }

    return this.mapAffiliate(data);
  }

  /**
   * Get affiliate by user ID
   */
  async getAffiliateByUserId(userId: string): Promise<Affiliate | null> {
    const { data, error } = await supabaseAdmin
      .from('affiliates')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapAffiliate(data);
  }

  /**
   * Get affiliate by ID
   */
  async getAffiliateById(affiliateId: string): Promise<Affiliate | null> {
    const { data, error } = await supabaseAdmin
      .from('affiliates')
      .select('*')
      .eq('id', affiliateId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapAffiliate(data);
  }

  /**
   * Get affiliate by referral code and active status
   */
  async getAffiliateByReferralCode(referralCode: string): Promise<Affiliate | null> {
    const { data, error } = await supabaseAdmin
      .from('affiliates')
      .select('*')
      .eq('referral_code', referralCode)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapAffiliate(data);
  }

  /**
   * Generate a product affiliate link and store it in affiliate_links
   */
  async generateProductAffiliateLink(
    affiliateId: string,
    productId: string
  ): Promise<AffiliateLink> {
    console.log('🔍 generateProductAffiliateLink called with:', { affiliateId, productId });
    
    const affiliate = await this.getAffiliateById(affiliateId);
    if (!affiliate) {
      console.error('❌ Affiliate not found for ID:', affiliateId);
      throw new Error('Affiliate not found');
    }

    console.log('✅ Affiliate found:', affiliate.referralCode);

    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('slug')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      console.error('❌ Product not found for ID:', productId, productError);
      throw new Error('Product not found');
    }

    console.log('✅ Product found:', product.slug);

    const productSlug = product.slug || productId;
    const normalizedFrontendUrl = frontendUrl.replace(/\/$/, '');
    const generatedUrl = `${normalizedFrontendUrl}/product/${encodeURIComponent(
      productSlug
    )}?ref=${encodeURIComponent(affiliate.referralCode)}`;

    console.log('✅ Generated URL:', generatedUrl);

    const { data: existingLink } = await supabaseAdmin
      .from('affiliate_links')
      .select('*')
      .eq('affiliate_id', affiliateId)
      .eq('product_id', productId)
      .single();

    if (existingLink) {
      console.log('✅ Existing link found, returning mapped link');
      const mapped = this.mapAffiliateLink(existingLink);
      console.log('✅ Mapped existing link:', mapped);
      return mapped;
    }

    console.log('🔄 Inserting new affiliate link into database');

    const { data, error: insertError } = await supabaseAdmin
      .from('affiliate_links')
      .insert({
        affiliate_id: affiliateId,
        product_id: productId,
        referral_code: affiliate.referralCode,
        generated_url: generatedUrl,
        clicks: 0,
        conversions: 0,
      })
      .select()
      .single();

    if (insertError || !data) {
      console.error('❌ Failed to insert affiliate link:', insertError?.message || 'Unknown error');
      throw new Error(`Failed to create affiliate link: ${insertError?.message || 'Unknown error'}`);
    }

    console.log('✅ Link inserted successfully:', data);
    const mapped = this.mapAffiliateLink(data);
    console.log('✅ Mapped link returned:', mapped);

    return mapped;
  }

  /**
   * Get dashboard statistics for affiliate
   */
  async getDashboardStats(affiliateId: string): Promise<DashboardStats> {
    const affiliate = await this.getAffiliateById(affiliateId);
    if (!affiliate) {
      throw new Error('Affiliate not found');
    }

    // Calculate this month earnings
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: thisMonthData } = await supabaseAdmin
      .from('affiliate_earnings')
      .select('amount')
      .eq('affiliate_id', affiliateId)
      .in('status', ['approved', 'paid'])
      .gte('created_at', startOfMonth.toISOString());

    const thisMonthEarnings = thisMonthData?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

    // Calculate last month earnings
    const startOfLastMonth = new Date(startOfMonth);
    startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);
    const endOfLastMonth = new Date(startOfMonth);

    const { data: lastMonthData } = await supabaseAdmin
      .from('affiliate_earnings')
      .select('amount')
      .eq('affiliate_id', affiliateId)
      .in('status', ['approved', 'paid'])
      .gte('created_at', startOfLastMonth.toISOString())
      .lt('created_at', endOfLastMonth.toISOString());

    const lastMonthEarnings = lastMonthData?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

    const conversionRate =
      affiliate.totalClicks > 0
        ? ((affiliate.totalConversions / affiliate.totalClicks) * 100).toFixed(2)
        : '0';

    return {
      totalEarnings: affiliate.totalEarnings,
      pendingEarnings: affiliate.pendingEarnings,
      totalClicks: affiliate.totalClicks,
      totalConversions: affiliate.totalConversions,
      conversionRate,
      thisMonthEarnings,
      lastMonthEarnings,
      tier: affiliate.tier,
      referralCode: affiliate.referralCode,
    };
  }

  /**
   * Get chart data for last 12 months
   */
  async getChartData(affiliateId: string, showPlaceholder: boolean = false): Promise<ChartData> {
    const affiliate = await this.getAffiliateById(affiliateId);
    if (!affiliate) {
      throw new Error('Affiliate not found');
    }

    // Check if affiliate has any data
    const hasAnyData = affiliate.totalEarnings > 0 || affiliate.totalClicks > 0;

    // If no data, return empty arrays with isEmpty flag
    if (!hasAnyData) {
      const labels = this.getMonthLabels();
      return {
        labels,
        earnings: new Array(12).fill(0),
        clicks: new Array(12).fill(0),
        conversions: new Array(12).fill(0),
        isEmpty: true,
        dataType: 'empty',
        message: 'No earnings recorded yet. Create referral links and share them to start earning!',
      };
    }

    // Generate real data
    const labels: string[] = [];
    const earnings: number[] = [];
    const clicks: number[] = [];
    const conversions: number[] = [];

    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

      labels.push(date.toLocaleString('default', { month: 'short' }));

      // Get earnings for this month
      const { data: earningData } = await supabaseAdmin
        .from('affiliate_earnings')
        .select('amount')
        .eq('affiliate_id', affiliateId)
        .in('status', ['approved', 'paid'])
        .gte('created_at', monthStart.toISOString())
        .lte('created_at', monthEnd.toISOString());

      const monthEarnings = earningData?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
      earnings.push(parseFloat(monthEarnings.toFixed(2)));

      // Get clicks for this month
      const { data: clickData } = await supabaseAdmin
        .from('affiliate_clicks')
        .select('id')
        .eq('referral_code', affiliate.referralCode)
        .gte('created_at', monthStart.toISOString())
        .lte('created_at', monthEnd.toISOString());

      clicks.push(clickData?.length || 0);

      // Get conversions for this month
      const { data: conversionData } = await supabaseAdmin
        .from('affiliate_clicks')
        .select('id')
        .eq('referral_code', affiliate.referralCode)
        .eq('converted', true)
        .gte('created_at', monthStart.toISOString())
        .lte('created_at', monthEnd.toISOString());

      conversions.push(conversionData?.length || 0);
    }

    return {
      labels,
      earnings,
      clicks,
      conversions,
      isEmpty: false,
      dataType: 'real',
    };
  }

  /**
   * Get month labels for the last 12 months
   */
  private getMonthLabels(): string[] {
    const labels: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      labels.push(date.toLocaleString('default', { month: 'short' }));
    }
    return labels;
  }

  /**
   * Get recent earnings (last 10)
   */
  async getRecentEarnings(affiliateId: string, limit: number = 10): Promise<Earning[]> {
    const { data, error } = await supabaseAdmin
      .from('affiliate_earnings')
      .select('*')
      .eq('affiliate_id', affiliateId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) {
      return [];
    }

    return data.map(e => this.mapEarning(e));
  }

  /**
   * Get paginated earnings
   */
  async getEarnings(
    affiliateId: string,
    status?: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ earnings: Earning[]; total: number; page: number; totalPages: number }> {
    let query = supabaseAdmin.from('affiliate_earnings').select('*', { count: 'exact' }).eq('affiliate_id', affiliateId);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const offset = (page - 1) * limit;
    const { data, error, count } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Failed to fetch earnings: ${error.message}`);
    }

    return {
      earnings: (data || []).map(e => this.mapEarning(e)),
      total: count || 0,
      page,
      totalPages: Math.ceil((count || 0) / limit),
    };
  }

  /**
   * Get earnings summary by status
   */
  async getEarningsSummary(affiliateId: string): Promise<{ approved: number; pending: number; paid: number }> {
    const { data: approvedData } = await supabaseAdmin
      .from('affiliate_earnings')
      .select('amount')
      .eq('affiliate_id', affiliateId)
      .eq('status', 'approved');

    const { data: pendingData } = await supabaseAdmin
      .from('affiliate_earnings')
      .select('amount')
      .eq('affiliate_id', affiliateId)
      .eq('status', 'pending');

    const { data: paidData } = await supabaseAdmin
      .from('affiliate_earnings')
      .select('amount')
      .eq('affiliate_id', affiliateId)
      .eq('status', 'paid');

    const approved = approvedData?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
    const pending = pendingData?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
    const paid = paidData?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

    return { approved, pending, paid };
  }

  /**
   * Create earning record for an order (called on order creation)
   */
  async createEarning(
    affiliateId: string,
    orderId: string,
    productId: string,
    productName: string,
    orderAmount: number
  ): Promise<Earning> {
    const affiliate = await this.getAffiliateById(affiliateId);
    if (!affiliate) {
      throw new Error('Affiliate not found');
    }

    const rate = this.COMMISSION_RATES[affiliate.tier as keyof CommissionRates] || 0.08;
    const commissionAmount = parseFloat((orderAmount * rate).toFixed(2));

    const { data, error } = await supabaseAdmin
      .from('affiliate_earnings')
      .insert({
        affiliate_id: affiliateId,
        order_id: orderId,
        product_id: productId,
        product_name: productName,
        amount: commissionAmount,
        commission_rate: rate,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create earning: ${error.message}`);
    }

    // Update affiliate pending earnings
    await supabaseAdmin.rpc('increment_pending_earnings', {
      affiliate_id: affiliateId,
      amount: commissionAmount,
    });

    return this.mapEarning(data);
  }

  /**
   * Get monthly earnings breakdown
   */
  async getMonthlyEarnings(
    affiliateId: string,
    year?: number
  ): Promise<Array<{ month: string; earnings: number; commissions: number }>> {
    const targetYear = year || new Date().getFullYear();
    const result: Array<{ month: string; earnings: number; commissions: number }> = [];

    // Get affiliate tier for real commission rate lookup
    const affiliate = await this.getAffiliateById(affiliateId);
    if (!affiliate) {
      throw new Error('Affiliate not found');
    }

    const affiliateTier = affiliate.tier as keyof CommissionRates;
    const commissionRate = this.COMMISSION_RATES[affiliateTier] || 0.08;
    const commissionPercentage = commissionRate * 100; // Convert to percentage (8%, 10%, 12%)

    for (let i = 1; i <= 12; i++) {
      const monthStart = new Date(targetYear, i - 1, 1);
      const monthEnd = new Date(targetYear, i, 0);

      const { data: earningsData } = await supabaseAdmin
        .from('affiliate_earnings')
        .select('amount')
        .eq('affiliate_id', affiliateId)
        .in('status', ['approved', 'paid'])
        .gte('created_at', monthStart.toISOString())
        .lte('created_at', monthEnd.toISOString());

      const earnings = earningsData?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
      const monthName = monthStart.toLocaleString('default', { month: 'long' });

      result.push({
        month: monthName,
        earnings: parseFloat(earnings.toFixed(2)),
        commissions: parseFloat(commissionPercentage.toFixed(2)), // Real commission rate from affiliate tier
      });
    }

    return result;
  }

  /**
   * Get earnings breakdown by product tier/category
   */
  async getEarningsByTier(affiliateId: string): Promise<
    Array<{
      tier: string;
      totalEarnings: number;
      totalOrders: number;
      rate: number;
    }>
  > {
    const tiers = ['starter', 'pro', 'elite'];
    const result = [];

    for (const tier of tiers) {
      const rate = this.COMMISSION_RATES[tier as keyof CommissionRates] * 100;

      const { data: earnings, count } = await supabaseAdmin
        .from('affiliate_earnings')
        .select('amount', { count: 'exact' })
        .eq('affiliate_id', affiliateId)
        .in('status', ['approved', 'paid']);

      // Filter by tier (in real implementation, this would be based on product tier)
      // For now, we'll calculate total earnings
      const totalEarnings = earnings?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

      result.push({
        tier: tier.charAt(0).toUpperCase() + tier.slice(1),
        totalEarnings: parseFloat(totalEarnings.toFixed(2)),
        totalOrders: count || 0,
        rate,
      });
    }

    return result;
  }

  /**
   * Export earnings to CSV format
   */
  async exportEarnings(
    affiliateId: string,
    format: 'csv' | 'json' = 'csv',
    filters?: {
      status?: string;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<string> {
    let query = supabaseAdmin.from('affiliate_earnings').select('*').eq('affiliate_id', affiliateId);

    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    if (filters?.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    if (filters?.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    const { data: earnings, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to export earnings: ${error.message}`);
    }

    if (!earnings || earnings.length === 0) {
      throw new Error('No earnings found to export');
    }

    if (format === 'csv') {
      return this.generateCSV(earnings);
    } else {
      return JSON.stringify(earnings, null, 2);
    }
  }

  /**
   * Helper: Generate CSV from earnings data
   */
  private generateCSV(earnings: any[]): string {
    const headers = ['Order ID', 'Product Name', 'Amount', 'Status', 'Date'];
    const rows = earnings.map(e => [
      e.order_id,
      e.product_name,
      e.amount.toFixed(2),
      e.status,
      new Date(e.created_at).toLocaleDateString(),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  }

  /**
   * Get referral links for affiliate with real-time stats from click_logs
   */
  async getReferralLinks(affiliateId: string): Promise<ReferralLink[]> {
    const { data: links, error } = await supabaseAdmin
      .from('referral_links')
      .select('*')
      .eq('affiliate_id', affiliateId)
      .order('created_at', { ascending: false });

    if (error || !links) {
      return [];
    }

    // Enhance each link with real-time stats from affiliate_clicks
    const enrichedLinks = await Promise.all(
      links.map(async (link) => {
        const { count: clickCount } = await supabaseAdmin
          .from('affiliate_clicks')
          .select('id', { count: 'exact' })
          .eq('referral_code', link.referral_code);

        const { count: conversionCount } = await supabaseAdmin
          .from('affiliate_clicks')
          .select('id', { count: 'exact' })
          .eq('referral_code', link.referral_code)
          .eq('converted', true);

        const { data: earningsData } = await supabaseAdmin
          .from('affiliate_earnings')
          .select('amount')
          .eq('affiliate_id', affiliateId)
          .in('status', ['approved', 'paid']);

        const totalEarnings = earningsData?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

        return {
          ...link,
          clicks: clickCount || 0,
          conversions: conversionCount || 0,
          earnings: totalEarnings,
        };
      })
    );

    return enrichedLinks.map(l => this.mapReferralLink(l));
  }

  /**
   * Get product affiliate links for an affiliate
   */
  async getAffiliateLinks(affiliateId: string): Promise<AffiliateLink[]> {
    const { data: links, error } = await supabaseAdmin
      .from('affiliate_links')
      .select('*')
      .eq('affiliate_id', affiliateId)
      .order('created_at', { ascending: false });

    if (error || !links) {
      return [];
    }

    return links.map(link => this.mapAffiliateLink(link));
  }

  /**
   * Create referral link
   */
  async createReferralLink(
    affiliateId: string,
    name: string,
    source?: string
  ): Promise<ReferralLink> {
    const affiliate = await this.getAffiliateById(affiliateId);
    if (!affiliate) {
      throw new Error('Affiliate not found');
    }

    const baseUrl = frontendUrl;
    const url = `${baseUrl}?ref=${affiliate.referralCode}${source ? `&utm_source=${source}` : ''}`;
    // For now, use the URL as short URL (can integrate with short URL service later)
    const shortUrl = `${baseUrl}?ref=${affiliate.referralCode}`;

    const { data, error } = await supabaseAdmin
      .from('referral_links')
      .insert({
        affiliate_id: affiliateId,
        name,
        url,
        short_url: shortUrl,
        source: source || null,
        clicks: 0,
        conversions: 0,
        earnings: 0,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create referral link: ${error.message}`);
    }

    return this.mapReferralLink(data);
  }

  /**
   * Delete referral link
   */
  async deleteReferralLink(affiliateId: string, linkId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from('referral_links')
      .delete()
      .eq('id', linkId)
      .eq('affiliate_id', affiliateId);

    if (error) {
      throw new Error(`Failed to delete referral link: ${error.message}`);
    }
  }

  /**
   * Get stats for a specific referral link
   */
  async getLinkStats(
    affiliateId: string,
    linkId: string
  ): Promise<{
    linkId: string;
    clicks: number;
    conversions: number;
    earnings: number;
    conversionRate: string;
  }> {
    let referralCode: string | null = null;

    // Try referral_links first
    const { data: referralLink } = await supabaseAdmin
      .from('referral_links')
      .select('referral_code')
      .eq('id', linkId)
      .eq('affiliate_id', affiliateId)
      .single();

    if (referralLink && referralLink.referral_code) {
      referralCode = referralLink.referral_code;
    }

    if (!referralCode) {
      const { data: productLink } = await supabaseAdmin
        .from('affiliate_links')
        .select('referral_code')
        .eq('id', linkId)
        .eq('affiliate_id', affiliateId)
        .single();

      if (productLink && productLink.referral_code) {
        referralCode = productLink.referral_code;
      }
    }

    if (!referralCode) {
      throw new Error('Referral link not found');
    }

    const { count: clickCount } = await supabaseAdmin
      .from('affiliate_clicks')
      .select('id', { count: 'exact' })
      .eq('referral_code', referralCode);

    const { count: conversionCount } = await supabaseAdmin
      .from('affiliate_clicks')
      .select('id', { count: 'exact' })
      .eq('referral_code', referralCode)
      .eq('converted', true);

    const { data: earningsData } = await supabaseAdmin
      .from('affiliate_earnings')
      .select('amount')
      .eq('affiliate_id', affiliateId)
      .in('status', ['approved', 'paid']);

    const totalEarnings = earningsData?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

    const clicks = clickCount || 0;
    const conversions = conversionCount || 0;
    const conversionRate =
      clicks > 0 ? ((conversions / clicks) * 100).toFixed(2) : '0';

    return {
      linkId,
      clicks,
      conversions,
      earnings: totalEarnings,
      conversionRate,
    };
  }

  /**
   * Update referral link details
   */
  async updateReferralLink(
    affiliateId: string,
    linkId: string,
    updates: {
      name?: string;
      source?: string;
      status?: 'active' | 'inactive';
    }
  ): Promise<ReferralLink> {
    // Verify link exists and belongs to affiliate
    const { data: link } = await supabaseAdmin
      .from('referral_links')
      .select('*')
      .eq('id', linkId)
      .eq('affiliate_id', affiliateId)
      .single();

    if (!link) {
      throw new Error('Referral link not found');
    }

    // Build update object (only include provided fields)
    const updateData: Record<string, any> = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.source !== undefined) updateData.source = updates.source;
    if (updates.status !== undefined) updateData.status = updates.status;

    if (Object.keys(updateData).length === 0) {
      throw new Error('No fields to update');
    }

    const { data, error } = await supabaseAdmin
      .from('referral_links')
      .update(updateData)
      .eq('id', linkId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update referral link: ${error.message}`);
    }

    return this.mapReferralLink(data);
  }

  /**
   * Get payment methods for affiliate
   */
  async getPaymentMethods(affiliateId: string): Promise<PaymentMethod[]> {
    const { data, error } = await supabaseAdmin
      .from('payout_methods')
      .select('*')
      .eq('affiliate_id', affiliateId);

    if (error || !data) {
      return [];
    }

    return data.map(m => this.mapPaymentMethod(m));
  }

  /**
   * Add payment method
   */
  async addPaymentMethod(
    affiliateId: string,
    type: 'bank' | 'momo' | 'crypto' | 'paypal',
    name: string,
    details: string
  ): Promise<PaymentMethod> {
    // Check if this is the first payment method
    const existing = await this.getPaymentMethods(affiliateId);
    const isDefault = existing.length === 0;

    const { data, error } = await supabaseAdmin
      .from('payout_methods')
      .insert({
        affiliate_id: affiliateId,
        method_type: type,
        account_name: name,
        provider: details,
        is_default: isDefault,
        is_verified: false,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add payment method: ${error.message}`);
    }

    return this.mapPaymentMethod(data);
  }

  /**
   * Delete payment method
   */
  async deletePaymentMethod(affiliateId: string, methodId: string): Promise<void> {
    // Check if this is the default method
    const { data: method } = await supabaseAdmin
      .from('payout_methods')
      .select('is_default')
      .eq('id', methodId)
      .eq('affiliate_id', affiliateId)
      .single();

    if (!method) {
      throw new Error('Payment method not found');
    }

    // Delete the method
    const { error } = await supabaseAdmin
      .from('payout_methods')
      .delete()
      .eq('id', methodId)
      .eq('affiliate_id', affiliateId);

    if (error) {
      throw new Error(`Failed to delete payment method: ${error.message}`);
    }

    // If this was the default, set another as default
    if (method.is_default) {
      const { data: nextMethod } = await supabaseAdmin
        .from('payout_methods')
        .select('id')
        .eq('affiliate_id', affiliateId)
        .limit(1)
        .single();

      if (nextMethod) {
        await supabaseAdmin
          .from('payout_methods')
          .update({ is_default: true })
          .eq('id', nextMethod.id);
      }
    }
  }

  /**
   * Get payouts for affiliate
   */
  async getPayouts(affiliateId: string): Promise<Payout[]> {
    const { data, error } = await supabaseAdmin
      .from('payout_requests')
      .select('*')
      .eq('affiliate_id', affiliateId)
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data.map(p => this.mapPayout(p));
  }

  /**
   * Request payout
   */
  async requestPayout(
    affiliateId: string,
    amount: number,
    methodId: string
  ): Promise<Payout> {
    // Validate minimum payout
    if (amount < this.MIN_PAYOUT) {
      throw new Error(`Minimum payout is $${this.MIN_PAYOUT}`);
    }

    // Verify affiliate and payment method exist
    const affiliate = await this.getAffiliateById(affiliateId);
    if (!affiliate) {
      throw new Error('Affiliate not found');
    }

    const { data: method } = await supabaseAdmin
      .from('payout_methods')
      .select('*')
      .eq('id', methodId)
      .eq('affiliate_id', affiliateId)
      .single();

    if (!method) {
      throw new Error('Payment method not found');
    }

    // Check available balance
    const availableBalance = affiliate.totalEarnings - affiliate.pendingEarnings;
    if (amount > availableBalance) {
      throw new Error('Insufficient balance');
    }

    const { data, error } = await supabaseAdmin
      .from('payout_requests')
      .insert({
        affiliate_id: affiliateId,
        amount,
        payout_method_id: methodId,
        method: method.method_type,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to request payout: ${error.message}`);
    }

    return this.mapPayout(data);
  }

  /**
   * Get payout summary (count by status)
   */
  async getPayoutsSummary(
    affiliateId: string
  ): Promise<{
    totalRequested: number;
    totalPaid: number;
    pendingPayouts: number;
    nextPayoutDate: string | null;
    minimumPayout: number;
  }> {
    // Count and sum payouts by status
    const { data: allPayouts } = await supabaseAdmin
      .from('payout_requests')
      .select('amount, status')
      .eq('affiliate_id', affiliateId);

    let totalRequested = 0;
    let totalPaid = 0;
    let pendingCount = 0;

    (allPayouts || []).forEach((payout) => {
      if (payout.status === 'completed') {
        totalPaid += payout.amount;
      }
      if (payout.status === 'pending' || payout.status === 'processing') {
        totalRequested += payout.amount;
        if (payout.status === 'pending') pendingCount++;
      }
    });

    // Calculate next payout date (assuming payouts are processed every Monday)
    const today = new Date();
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + ((1 + 7 - today.getDay()) % 7));
    if (nextMonday.getTime() === today.getTime()) {
      nextMonday.setDate(nextMonday.getDate() + 7);
    }

    return {
      totalRequested,
      totalPaid,
      pendingPayouts: pendingCount,
      nextPayoutDate: nextMonday.toISOString().split('T')[0],
      minimumPayout: this.MIN_PAYOUT,
    };
  }

  /**
   * Cancel a pending payout
   */
  async cancelPayout(affiliateId: string, payoutId: string): Promise<Payout> {
    // Verify payout exists and belongs to affiliate
    const { data: payout } = await supabaseAdmin
      .from('payout_requests')
      .select('*')
      .eq('id', payoutId)
      .eq('affiliate_id', affiliateId)
      .single();

    if (!payout) {
      throw new Error('Payout not found');
    }

    // Only allow cancelling pending payouts
    if (payout.status !== 'pending') {
      throw new Error(`Cannot cancel payout with status '${payout.status}'`);
    }

    // Update status to cancelled
    const { data: updated, error } = await supabaseAdmin
      .from('payout_requests')
      .update({ status: 'cancelled' })
      .eq('id', payoutId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to cancel payout: ${error.message}`);
    }

    return this.mapPayout(updated);
  }

  /**
   * Set default payment method
   */
  async setDefaultPaymentMethod(affiliateId: string, methodId: string): Promise<PaymentMethod> {
    // Verify payment method exists and belongs to affiliate
    const { data: method } = await supabaseAdmin
      .from('payout_methods')
      .select('*')
      .eq('id', methodId)
      .eq('affiliate_id', affiliateId)
      .single();

    if (!method) {
      throw new Error('Payment method not found');
    }

    // Update all methods to is_default=false for this affiliate
    await supabaseAdmin
      .from('payout_methods')
      .update({ is_default: false })
      .eq('affiliate_id', affiliateId);

    // Set this method as default
    const { data: updated, error } = await supabaseAdmin
      .from('payout_methods')
      .update({ is_default: true })
      .eq('id', methodId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to set default payment method: ${error.message}`);
    }

    return this.mapPaymentMethod(updated);
  }

  /**
   * Track affiliate click
   */
  async trackClick(
    referralCode: string,
    ip: string,
    userAgent: string,
    source?: string,
    landingPage?: string
  ): Promise<void> {
    const affiliate = await this.getAffiliateByReferralCode(referralCode);
    if (!affiliate) {
      console.log(`[AFFILIATE] Invalid referral code: ${referralCode}`);
      return;
    }

    // Prevent duplicate clicks from same IP within 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const { data: recentClicks } = await supabaseAdmin
      .from('affiliate_clicks')
      .select('id')
      .eq('referral_code', referralCode)
      .eq('ip_address', ip)
      .gte('created_at', fiveMinutesAgo.toISOString())
      .limit(1);

    if (recentClicks && recentClicks.length > 0) {
      console.log(`[AFFILIATE] Duplicate click prevented for ${referralCode} from IP: ${ip}`);
      return;
    }

    const { data: link } = await supabaseAdmin
      .from('affiliate_links')
      .select('id')
      .eq('referral_code', referralCode)
      .single();

    const { error } = await supabaseAdmin.from('affiliate_clicks').insert({
      affiliate_id: affiliate.id,
      referral_code: referralCode,
      link_id: link?.id || null,
      ip_address: ip,
      user_agent: userAgent,
      landing_page: landingPage,
      source: source || 'direct',
      converted: false,
    });

    if (error) {
      console.error(`[AFFILIATE] Failed to log click for ${referralCode}:`, error);
      return;
    }

    console.log(`[AFFILIATE] Click stored for ${referralCode} from IP: ${ip}`);

    // Increment total clicks for affiliate
    await supabaseAdmin.rpc('increment_total_clicks', {
      affiliate_id: affiliate.id,
    });

    // Increment clicks for all affiliate links with this referral code
    const { error: linkError } = await supabaseAdmin.rpc('increment_affiliate_link_clicks_all', {
      referral_code_param: referralCode,
    });

    if (linkError) {
      console.error(`[AFFILIATE] Failed to increment link clicks for ${referralCode}:`, linkError);
    }
  }

  /**
   * Attribute earnings for order (call after order is created)
   */
  async attributeEarningsForOrder(
    orderId: string,
    userId: string,
    affiliateRef: string | null,
    orderAmount: number
  ): Promise<void> {
    if (!affiliateRef) return;

    console.log(`[AFFILIATE] Attributing order ${orderId} to referral: ${affiliateRef}`);

    try {
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('referral_code', affiliateRef)
        .eq('status', 'active')
        .single();

      if (!affiliate) {
        console.log(`[AFFILIATE] No active affiliate found for referral: ${affiliateRef}`);
        return;
      }

      // Get first product from order (or you can iterate through items)
      const { data: orderItems } = await supabaseAdmin
        .from('order_items')
        .select('product_id, products(name)')
        .eq('order_id', orderId)
        .limit(1);

      if (!orderItems || orderItems.length === 0) {
        console.log(`[AFFILIATE] No order items found for order: ${orderId}`);
        return;
      }

      const productId = orderItems[0].product_id;
      const productName = orderItems[0].products?.[0]?.name || 'Product';

      console.log(`[AFFILIATE] Creating earning for affiliate ${affiliate.id}, order ${orderId}, amount: ${orderAmount}`);

      await this.createEarning(affiliate.id, orderId, productId, productName, orderAmount);

      // Mark click as converted
      const { data: latestClick } = await supabaseAdmin
        .from('affiliate_clicks')
        .select('id')
        .eq('referral_code', affiliateRef)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (latestClick) {
        await supabaseAdmin.from('affiliate_clicks').update({ converted: true }).eq('id', latestClick.id);
        console.log(`[AFFILIATE] Marked click ${latestClick.id} as converted`);
      }

      // Increment total conversions
      await supabaseAdmin.rpc('increment_total_conversions', {
        affiliate_id: affiliate.id,
      });

      // Increment conversions for all affiliate links with this referral code
      const { error: linkError } = await supabaseAdmin.rpc('increment_affiliate_link_conversions_all', {
        referral_code_param: affiliateRef,
      });

      if (linkError) {
        console.error(`[AFFILIATE] Failed to increment link conversions for ${affiliateRef}:`, linkError);
      } else {
        console.log(`[AFFILIATE] Commission generated for order ${orderId}`);
      }

    } catch (error) {
      console.error('[AFFILIATE] Affiliate attribution error:', error);
    }
  }

  // Helper methods
  private generateReferralCode(): string {
    return 'AFF' + Math.random().toString(36).substring(2, 11).toUpperCase();
  }

  private mapAffiliate(data: any): Affiliate {
    return {
      id: data.id,
      userId: data.user_id,
      referralCode: data.referral_code,
      tier: data.tier,
      status: data.status,
      totalEarnings: data.total_earnings || 0,
      pendingEarnings: data.pending_earnings || 0,
      totalClicks: data.total_clicks || 0,
      totalConversions: data.total_conversions || 0,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  private mapEarning(data: any): Earning {
    return {
      id: data.id,
      affiliateId: data.affiliate_id,
      orderId: data.order_id,
      productId: data.product_id,
      productName: data.product_name,
      amount: data.amount,
      status: data.status,
      verifiedAt: data.verified_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  private mapReferralLink(data: any): ReferralLink {
    return {
      id: data.id,
      affiliateId: data.affiliate_id,
      name: data.name,
      url: data.url,
      shortUrl: data.short_url,
      source: data.source,
      clicks: data.clicks,
      conversions: data.conversions,
      earnings: data.earnings,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  private mapAffiliateLink(data: any): AffiliateLink {
    return {
      id: data.id,
      affiliateId: data.affiliate_id,
      productId: data.product_id,
      referralCode: data.referral_code,
      generatedUrl: data.generated_url,
      clicks: data.clicks,
      conversions: data.conversions,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  private mapPaymentMethod(data: any): PaymentMethod {
    return {
      id: data.id,
      affiliateId: data.affiliate_id,
      type: data.method_type || data.type,
      name: data.account_name || data.name,
      details: data.provider || data.details || '',
      isDefault: data.is_default,
      isVerified: data.is_verified,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  private mapPayout(data: any): Payout {
    return {
      id: data.id,
      affiliateId: data.affiliate_id,
      amount: data.amount,
      method: data.method,
      status: data.status,
      reference: data.reference,
      processedAt: data.processed_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Get campaigns available to affiliates
   */
  async getCampaigns(affiliateId: string, status?: string): Promise<any[]> {
    let query = supabaseAdmin.from('campaigns').select('*');

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query.order('start_date', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      status: c.status,
      startDate: c.start_date,
      endDate: c.end_date,
      commissionBonus: c.commission_bonus,
      imageUrl: c.image_url,
      products: c.products || [],
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
  }

  /**
   * Get campaign details
   */
  async getCampaign(campaignId: string): Promise<any> {
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (error || !data) {
      throw new Error('Campaign not found');
    }

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      status: data.status,
      startDate: data.start_date,
      endDate: data.end_date,
      commissionBonus: data.commission_bonus,
      imageUrl: data.image_url,
      products: data.products || [],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Get campaign statistics
   */
  async getCampaignStats(affiliateId: string, campaignId: string): Promise<any> {
    // Get clicks from campaign
    const { count: clicks } = await supabaseAdmin
      .from('affiliate_clicks')
      .select('id', { count: 'exact' })
      .eq('affiliate_id', affiliateId)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    // Get conversions from campaign
    const { count: conversions } = await supabaseAdmin
      .from('affiliate_clicks')
      .select('id', { count: 'exact' })
      .eq('affiliate_id', affiliateId)
      .eq('converted', true)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    // Get earnings from campaign
    const { data: earningsData } = await supabaseAdmin
      .from('affiliate_earnings')
      .select('amount')
      .eq('affiliate_id', affiliateId)
      .in('status', ['approved', 'paid'])
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    const earnings = earningsData?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('campaigns')
      .select('products')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      throw new Error('Campaign not found');
    }

    return {
      campaignId,
      clicks: clicks || 0,
      conversions: conversions || 0,
      earnings: parseFloat(earnings.toFixed(2)),
      products: campaign.products || [],
    };
  }

  /**
   * Get notifications for user
   */
  async getNotifications(userId: string, limit: number = 10): Promise<any[]> {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) {
      return [];
    }

    return data.map(n => ({
      id: n.id,
      userId: n.user_id,
      title: n.title,
      message: n.message,
      type: n.type,
      read: n.read,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    }));
  }

  /**
   * Get unread notification count
   */
  async getUnreadNotificationCount(userId: string): Promise<number> {
    const { count, error } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact' })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) {
      return 0;
    }

    return count || 0;
  }

  /**
   * Mark notification as read
   */
  async markNotificationAsRead(userId: string, notificationId: string): Promise<any> {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to mark notification as read: ${error.message}`);
    }

    return {
      id: data.id,
      userId: data.user_id,
      title: data.title,
      message: data.message,
      type: data.type,
      read: data.read,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Get affiliate settings
   */
  async getAffiliateSettings(affiliateId: string): Promise<any> {
    const { data, error } = await supabaseAdmin
      .from('affiliate_settings')
      .select('*')
      .eq('affiliate_id', affiliateId)
      .single();

    if (error) {
      // Return default settings if none exist
      return {
        id: null,
        affiliateId,
        emailNotifications: true,
        monthlyReports: true,
        autoWithdrawal: false,
        autoWithdrawalAmount: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      id: data.id,
      affiliateId: data.affiliate_id,
      emailNotifications: data.email_notifications,
      monthlyReports: data.monthly_reports,
      autoWithdrawal: data.auto_withdrawal,
      autoWithdrawalAmount: data.auto_withdrawal_amount,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Update affiliate settings
   */
  async updateAffiliateSettings(
    affiliateId: string,
    updates: {
      emailNotifications?: boolean;
      monthlyReports?: boolean;
      autoWithdrawal?: boolean;
      autoWithdrawalAmount?: number;
    }
  ): Promise<any> {
    // Try to get existing settings first
    const { data: existing } = await supabaseAdmin
      .from('affiliate_settings')
      .select('id')
      .eq('affiliate_id', affiliateId)
      .single();

    let data, error;

    if (existing) {
      // Update existing
      const updateData: Record<string, any> = {
        affiliate_id: affiliateId,
      };
      if (updates.emailNotifications !== undefined) updateData.email_notifications = updates.emailNotifications;
      if (updates.monthlyReports !== undefined) updateData.monthly_reports = updates.monthlyReports;
      if (updates.autoWithdrawal !== undefined) updateData.auto_withdrawal = updates.autoWithdrawal;
      if (updates.autoWithdrawalAmount !== undefined) updateData.auto_withdrawal_amount = updates.autoWithdrawalAmount;

      const result = await supabaseAdmin
        .from('affiliate_settings')
        .update(updateData)
        .eq('affiliate_id', affiliateId)
        .select()
        .single();

      data = result.data;
      error = result.error;
    } else {
      // Create new
      const result = await supabaseAdmin
        .from('affiliate_settings')
        .insert({
          affiliate_id: affiliateId,
          email_notifications: updates.emailNotifications ?? true,
          monthly_reports: updates.monthlyReports ?? true,
          auto_withdrawal: updates.autoWithdrawal ?? false,
          auto_withdrawal_amount: updates.autoWithdrawalAmount ?? null,
        })
        .select()
        .single();

      data = result.data;
      error = result.error;
    }

    if (error) {
      throw new Error(`Failed to update settings: ${error.message}`);
    }

    return {
      id: data.id,
      affiliateId: data.affiliate_id,
      emailNotifications: data.email_notifications,
      monthlyReports: data.monthly_reports,
      autoWithdrawal: data.auto_withdrawal,
      autoWithdrawalAmount: data.auto_withdrawal_amount,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Get user profile
   */
  async getUserProfile(userId: string): Promise<any> {
    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      // Return minimal profile if not found
      return {
        id: null,
        userId,
        firstName: '',
        lastName: '',
        email: '',
        phone: null,
        avatar: null,
        bio: null,
        country: null,
        city: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      id: data.id,
      userId: data.user_id,
      firstName: data.first_name,
      lastName: data.last_name,
      email: data.email,
      phone: data.phone,
      avatar: data.avatar,
      bio: data.bio,
      country: data.country,
      city: data.city,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Update user profile
   */
  async updateUserProfile(
    userId: string,
    updates: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      avatar?: string;
      bio?: string;
      country?: string;
      city?: string;
    }
  ): Promise<any> {
    // Check if profile exists
    const { data: existing } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    let data, error;

    if (existing) {
      // Update existing
      const updateData: Record<string, any> = {};
      if (updates.firstName !== undefined) updateData.first_name = updates.firstName;
      if (updates.lastName !== undefined) updateData.last_name = updates.lastName;
      if (updates.phone !== undefined) updateData.phone = updates.phone;
      if (updates.avatar !== undefined) updateData.avatar = updates.avatar;
      if (updates.bio !== undefined) updateData.bio = updates.bio;
      if (updates.country !== undefined) updateData.country = updates.country;
      if (updates.city !== undefined) updateData.city = updates.city;

      const result = await supabaseAdmin
        .from('user_profiles')
        .update(updateData)
        .eq('user_id', userId)
        .select()
        .single();

      data = result.data;
      error = result.error;
    } else {
      // Create new profile
      const result = await supabaseAdmin
        .from('user_profiles')
        .insert({
          user_id: userId,
          first_name: updates.firstName || '',
          last_name: updates.lastName || '',
          email: '', // To be filled from auth
          phone: updates.phone || null,
          avatar: updates.avatar || null,
          bio: updates.bio || null,
          country: updates.country || null,
          city: updates.city || null,
        })
        .select()
        .single();

      data = result.data;
      error = result.error;
    }

    if (error) {
      throw new Error(`Failed to update profile: ${error.message}`);
    }

    return {
      id: data.id,
      userId: data.user_id,
      firstName: data.first_name,
      lastName: data.last_name,
      email: data.email,
      phone: data.phone,
      avatar: data.avatar,
      bio: data.bio,
      country: data.country,
      city: data.city,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Get user's affiliate tier
   */
  async getUserAffiliateTier(userId: string): Promise<any> {
    const { data, error } = await supabaseAdmin
      .from('affiliates')
      .select('tier,status,total_earnings,total_clicks,total_conversions')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return {
        tier: null,
        status: null,
        benefits: [],
        message: 'Affiliate account not found',
      };
    }

    const tierBenefits: Record<string, string[]> = {
      starter: ['8% commission', 'Dashboard access', 'Basic analytics'],
      pro: ['10% commission', 'Dashboard access', 'Advanced analytics', 'Priority support'],
      elite: ['12% commission', 'Dashboard access', 'Advanced analytics', 'Priority support', 'Dedicated manager'],
    };

    return {
      tier: data.tier,
      status: data.status,
      earnings: data.total_earnings,
      clicks: data.total_clicks,
      conversions: data.total_conversions,
      benefits: tierBenefits[data.tier] || [],
    };
  }
}

export const affiliateService = new AffiliateService();