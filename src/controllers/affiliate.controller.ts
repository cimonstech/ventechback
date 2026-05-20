// src/controllers/affiliate.controller.ts

import { Request, Response } from 'express';
import { successResponse, errorResponse, paginatedResponse } from '../utils/responseHandlers';
import { normalizePaymentMethod } from '../utils/payoutUtils';
import { affiliateService } from '../services/affiliate.service';
import { affiliatePayoutProcessor } from '../services/affiliatePayoutProcessor.service';
import { supabaseAdmin } from '../utils/supabaseClient';
import { sendAffiliateApplicationEmail } from '../services/email.service';

export class AffiliateController {
  /**
   * Submit affiliate application (public endpoint - existing)
   */
  async submitAffiliateApplication(req: Request, res: Response) {
    try {
      const {
        fullName,
        email,
        phone,
        country,
        promotionChannel,
        platformLink,
        audienceSize,
        payoutMethod,
        reason,
      } = req.body;

      // Validate required fields
      if (!fullName || !email || !phone || !country || !promotionChannel || !platformLink) {
        return res.status(400).json({
          success: false,
          message:
            'Missing required fields: fullName, email, phone, country, promotionChannel, and platformLink are required',
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format',
        });
      }

      // Validate URL format
      try {
        new URL(platformLink);
      } catch {
        return res.status(400).json({
          success: false,
          message: 'Invalid platform link format',
        });
      }

      // Attempt to send email notification
      const emailResult = await sendAffiliateApplicationEmail({
        fullName,
        email,
        phone,
        country,
        promotionChannel,
        platformLink,
        audienceSize: audienceSize || null,
        payoutMethod: payoutMethod || null,
        reason: reason || null,
      });

      if (!emailResult.success) {
        console.error('Failed to send affiliate application email:', emailResult.error);
      }

      return res.json({
        success: true,
        message:
          "Affiliate application submitted successfully! We'll review your application and get back to you soon.",
      });
    } catch (error) {
      console.error('Error processing affiliate application:', error);
      return res.status(200).json({
        success: false,
        message: 'Your application was received. Email notification will be retried by the server.',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get dashboard statistics (authenticated affiliates only)
   */
  async getDashboardStats(req: any, res: Response) {
    try {
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const stats = await affiliateService.getDashboardStats(affiliate.id);
      return successResponse(res, stats, 'Dashboard stats retrieved successfully');
    } catch (error) {
      console.error('Dashboard stats error:', error);
      return errorResponse(res, 'Failed to fetch dashboard stats', 500);
    }
  }

  /**
   * Get chart data for last 12 months
   */
  async getChartData(req: any, res: Response) {
    try {
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      // Only return real database data - no placeholder mock data in production
      const chartData = await affiliateService.getChartData(affiliate.id, false);
      return successResponse(res, chartData, 'Chart data retrieved successfully');
    } catch (error) {
      console.error('Chart data error:', error);
      return errorResponse(res, 'Failed to fetch chart data', 500);
    }
  }

  /**
   * Get recent earnings (last 10)
   */
  async getRecentEarnings(req: any, res: Response) {
    try {
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const earnings = await affiliateService.getRecentEarnings(affiliate.id);
      return successResponse(res, earnings, 'Recent earnings retrieved successfully');
    } catch (error) {
      console.error('Recent earnings error:', error);
      return errorResponse(res, 'Failed to fetch recent earnings', 500);
    }
  }

  /**
   * Get paginated earnings with optional status filter
   */
  async getEarnings(req: any, res: Response) {
    try {
      console.log('🔍 getEarnings called for user:', req.user?.id);

      const { status, page = '1', limit = '20' } = req.query;

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        console.error('❌ Affiliate not found for user:', req.user.id);
        return errorResponse(res, 'Affiliate not found', 404);
      }

      console.log('✅ Found affiliate:', affiliate.id);
      const result = await affiliateService.getEarnings(
        affiliate.id,
        status as string,
        parseInt(page as string),
        parseInt(limit as string)
      );

      console.log('✅ Retrieved earnings:', result.earnings?.length || 0, 'total:', result.total);

      return paginatedResponse(
        res,
        result.earnings,
        {
          page: result.page,
          limit: parseInt(limit as string),
          total: result.total,
          totalPages: result.totalPages,
        },
        'Earnings retrieved successfully'
      );
    } catch (error) {
      console.error('❌ Earnings error:', error);
      return errorResponse(res, 'Failed to fetch earnings', 500);
    }
  }

  /**
   * Get earnings summary by status
   */
  async getEarningsSummary(req: any, res: Response) {
    try {
      console.log('🔍 getEarningsSummary called for user:', req.user?.id);

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        console.error('❌ Affiliate not found for user:', req.user.id);
        return errorResponse(res, 'Affiliate not found', 404);
      }

      console.log('✅ Found affiliate:', affiliate.id);
      const summary = await affiliateService.getEarningsSummary(affiliate.id);
      console.log('✅ Retrieved earnings summary:', summary);

      return successResponse(res, summary, 'Earnings summary retrieved successfully');
    } catch (error) {
      console.error('❌ Earnings summary error:', error);
      return errorResponse(res, 'Failed to fetch earnings summary', 500);
    }
  }

  /**
   * Get monthly earnings breakdown
   */
  async getMonthlyEarnings(req: any, res: Response) {
    try {
      const { year } = req.query;

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const monthlyData = await affiliateService.getMonthlyEarnings(
        affiliate.id,
        year ? parseInt(year as string) : undefined
      );
      return successResponse(res, monthlyData, 'Monthly earnings retrieved successfully');
    } catch (error) {
      console.error('Monthly earnings error:', error);
      return errorResponse(res, 'Failed to fetch monthly earnings', 500);
    }
  }

  /**
   * Get earnings breakdown by tier
   */
  async getEarningsByTier(req: any, res: Response) {
    try {
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const tierBreakdown = await affiliateService.getEarningsByTier(affiliate.id);
      return successResponse(res, tierBreakdown, 'Earnings by tier retrieved successfully');
    } catch (error) {
      console.error('Earnings by tier error:', error);
      return errorResponse(res, 'Failed to fetch earnings by tier', 500);
    }
  }

  /**
   * Export earnings
   */
  async exportEarnings(req: any, res: Response) {
    try {
      const { format = 'csv', status, startDate, endDate } = req.query;

      if (!['csv', 'json'].includes(format as string)) {
        return errorResponse(res, 'Invalid format. Use csv or json', 400);
      }

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const exportData = await affiliateService.exportEarnings(affiliate.id, format as 'csv' | 'json', {
        status: status as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="earnings.csv"');
        return res.send(exportData);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="earnings.json"');
        return res.send(exportData);
      }
    } catch (error) {
      console.error('Export earnings error:', error);
      const message = error instanceof Error ? error.message : 'Failed to export earnings';
      return errorResponse(res, message, 400);
    }
  }

  /**
   * Get referral links
   */
  async getLinks(req: any, res: Response) {
    try {
      console.log('🔍 getLinks called for user:', req.user?.id);

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        console.error('❌ Affiliate not found for user:', req.user.id);
        return errorResponse(res, 'Affiliate not found', 404);
      }

      console.log('✅ Found affiliate:', affiliate.id);
      const links = await affiliateService.getReferralLinks(affiliate.id);
      console.log('✅ Retrieved links:', links?.length || 0);

      return successResponse(res, links, 'Referral links retrieved successfully');
    } catch (error) {
      console.error('❌ Links error:', error);
      return errorResponse(res, 'Failed to fetch links', 500);
    }
  }

  /**
   * Get generated product affiliate links
   */
  async getProductLinks(req: any, res: Response) {
    try {
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const links = await affiliateService.getAffiliateLinks(affiliate.id);
      return successResponse(res, links, 'Product affiliate links retrieved successfully');
    } catch (error) {
      console.error('❌ Product links error:', error);
      return errorResponse(res, 'Failed to fetch product links', 500);
    }
  }

  /**
   * Create new referral link
   */
  async createLink(req: any, res: Response) {
    try {
      const { name, source } = req.body;

      if (!name) {
        return errorResponse(res, 'Link name is required', 400);
      }

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const link = await affiliateService.createReferralLink(affiliate.id, name, source);
      return successResponse(res, link, 'Referral link created successfully', 201);
    } catch (error) {
      console.error('Create link error:', error);
      return errorResponse(res, 'Failed to create link', 500);
    }
  }

  /**
   * Generate affiliate URL for a product and store it in affiliate_links
   */
  async generateLink(req: any, res: Response) {
    try {
      const productId = req.body.productId || req.body.product_id;
      console.log('✅ generateLink called with productId:', productId);

      if (!productId || typeof productId !== 'string') {
        console.error('❌ Invalid productId:', productId);
        return errorResponse(res, 'productId or product_id is required and must be a string', 400);
      }

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id, referral_code')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        console.error('❌ Affiliate not found for user:', req.user.id);
        return errorResponse(res, 'Affiliate not found', 403);
      }

      console.log('✅ Affiliate found:', affiliate.id);

      const link = await affiliateService.generateProductAffiliateLink(
        affiliate.id,
        productId
      );

      console.log('✅ Link generated from service:', JSON.stringify(link, null, 2));
      console.log('✅ Link.generatedUrl:', link.generatedUrl);
      console.log('✅ Link.referralCode:', link.referralCode);
      console.log('✅ Link.productId:', link.productId);

      // Return response with generated URL in the data payload
      const responsePayload = {
        id: link.id,
        generated_url: link.generatedUrl,
        generatedUrl: link.generatedUrl,
        referral_code: link.referralCode,
        referralCode: link.referralCode,
        product_id: link.productId,
        productId: link.productId,
        clicks: link.clicks,
        conversions: link.conversions,
        created_at: link.createdAt,
        createdAt: link.createdAt,
      };

      console.log('✅ Final response payload:', JSON.stringify(responsePayload, null, 2));

      return successResponse(
        res,
        responsePayload,
        'Affiliate link generated successfully',
        201
      );
    } catch (error) {
      console.error('❌ Generate link error:', error);
      const message = error instanceof Error ? error.message : 'Failed to generate affiliate link';
      return errorResponse(res, message, 400);
    }
  }

  /**
   * Delete referral link
   */
  async deleteLink(req: any, res: Response) {
    try {
      const { id } = req.params;

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      await affiliateService.deleteReferralLink(affiliate.id, id);
      return successResponse(res, { message: 'Link deleted successfully' }, 'Link deleted');
    } catch (error) {
      console.error('Delete link error:', error);
      return errorResponse(res, 'Failed to delete link', 500);
    }
  }

  /**
   * Get stats for specific referral link
   */
  async getLinkStats(req: any, res: Response) {
    try {
      const { id } = req.params;

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const stats = await affiliateService.getLinkStats(affiliate.id, id);
      return successResponse(res, stats, 'Link stats retrieved successfully');
    } catch (error) {
      console.error('Link stats error:', error);
      const message = error instanceof Error ? error.message : 'Failed to fetch link stats';
      return errorResponse(res, message, 400);
    }
  }

  /**
   * Update referral link
   */
  async updateLink(req: any, res: Response) {
    try {
      const { id } = req.params;
      const { name, source, status } = req.body;

      if (!name && !source && !status) {
        return errorResponse(res, 'At least one field to update is required', 400);
      }

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const link = await affiliateService.updateReferralLink(affiliate.id, id, {
        name,
        source,
        status,
      });

      return successResponse(res, link, 'Referral link updated successfully');
    } catch (error) {
      console.error('Update link error:', error);
      const message = error instanceof Error ? error.message : 'Failed to update link';
      return errorResponse(res, message, 400);
    }
  }

  /**
   * Get payment methods
   */
  async getPaymentMethods(req: any, res: Response) {
    try {
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const methods = await affiliateService.getPaymentMethods(affiliate.id);
      return successResponse(res, methods, 'Payment methods retrieved successfully');
    } catch (error) {
      console.error('Payment methods error:', error);
      return errorResponse(res, 'Failed to fetch payment methods', 500);
    }
  }

  /**
   * Add payment method
   */
  async addPaymentMethod(req: any, res: Response) {
    try {
      const { type, name, details } = req.body;

      if (!type || !name || !details) {
        return errorResponse(res, 'Type, name, and details are required', 400);
      }

      if (!['bank', 'momo', 'crypto'].includes(type)) {
        return errorResponse(res, 'Invalid payment method type', 400);
      }

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const method = await affiliateService.addPaymentMethod(affiliate.id, type, name, details);
      return successResponse(res, method, 'Payment method added successfully', 201);
    } catch (error) {
      console.error('Add payment method error:', error);
      return errorResponse(res, 'Failed to add payment method', 500);
    }
  }

  /**
   * Delete payment method
   */
  async deletePaymentMethod(req: any, res: Response) {
    try {
      const { id } = req.params;

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      await affiliateService.deletePaymentMethod(affiliate.id, id);
      return successResponse(res, { message: 'Payment method deleted' }, 'Payment method deleted');
    } catch (error) {
      console.error('Delete payment method error:', error);
      return errorResponse(res, 'Failed to delete payment method', 500);
    }
  }

  /**
   * Get payouts
   */
  async getPayouts(req: any, res: Response) {
    try {
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const payouts = await affiliateService.getPayouts(affiliate.id);
      return successResponse(res, payouts, 'Payouts retrieved successfully');
    } catch (error) {
      console.error('Payouts error:', error);
      return errorResponse(res, 'Failed to fetch payouts', 500);
    }
  }

  /**
   * Request payout
   */
  async requestPayout(req: any, res: Response) {
    try {
      const { amount, methodId } = req.body;

      if (!amount || !methodId) {
        return errorResponse(res, 'Amount and payment method are required', 400);
      }

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const payout = await affiliateService.requestPayout(affiliate.id, amount, methodId);
      return successResponse(res, payout, 'Payout request created successfully', 201);
    } catch (error) {
      console.error('Request payout error:', error);
      const message = error instanceof Error ? error.message : 'Failed to request payout';
      return errorResponse(res, message, 400);
    }
  }

  /**
   * Get payout summary
   */
  async getPayoutsSummary(req: any, res: Response) {
    try {
      console.log('🔍 getPayoutsSummary called for user:', req.user?.id);

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        console.error('❌ Affiliate not found for user:', req.user.id);
        return errorResponse(res, 'Affiliate not found', 403);
      }

      console.log('✅ Found affiliate:', affiliate.id);
      const summary = await affiliateService.getPayoutsSummary(affiliate.id);
      console.log('✅ Retrieved payout summary:', summary);

      return successResponse(res, summary, 'Payout summary retrieved successfully');
    } catch (error) {
      console.error('❌ Payout summary error:', error);
      if (error instanceof Error) {
        console.error('   Stack:', error.stack);
      }
      return errorResponse(res, 'Failed to fetch payout summary', 500);
    }
  }

  /**
   * Cancel a pending payout
   */
  async cancelPayout(req: any, res: Response) {
    try {
      const { id } = req.params;

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const payout = await affiliateService.cancelPayout(affiliate.id, id);
      return successResponse(res, payout, 'Payout cancelled successfully');
    } catch (error) {
      console.error('Cancel payout error:', error);
      const message = error instanceof Error ? error.message : 'Failed to cancel payout';
      return errorResponse(res, message, 400);
    }
  }

  /**
   * Set default payment method
   */
  async setDefaultPaymentMethod(req: any, res: Response) {
    try {
      const { id } = req.params;

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const method = await affiliateService.setDefaultPaymentMethod(affiliate.id, id);
      return successResponse(res, method, 'Default payment method updated successfully');
    } catch (error) {
      console.error('Set default payment method error:', error);
      const message = error instanceof Error ? error.message : 'Failed to set default payment method';
      return errorResponse(res, message, 400);
    }
  }

  /**
   * Get products with commission rates
   */
  async getProducts(req: any, res: Response) {
    try {
      console.log('📦 [getProducts] Fetching affiliate tier for user:', req.user?.id);

      const { data: affiliate, error: affiliateError } = await supabaseAdmin
        .from('affiliates')
        .select('tier')
        .eq('user_id', req.user.id)
        .single();

      if (affiliateError) {
        console.error('❌ [getProducts] Error fetching affiliate:', affiliateError);
        return errorResponse(res, 'Affiliate not found', 404);
      }

      if (!affiliate) {
        console.warn('⚠️ [getProducts] Affiliate not found for user:', req.user?.id);
        return errorResponse(res, 'Affiliate not found', 404);
      }

      console.log('✅ [getProducts] Affiliate found with tier:', affiliate.tier);
      console.log('📥 [getProducts] Querying products table with in_stock=true');

      const { data: products, error } = await supabaseAdmin
        .from('products')
        .select('id, name, slug, description, thumbnail, images, price, discount_price, in_stock, stock_quantity, category_id, brand_id')
        .eq('in_stock', true)
        .gt('stock_quantity', 0)
        .limit(100);

      if (error) {
        console.error('❌ [getProducts] Supabase error:', error.message, error.details);
        return errorResponse(res, `Failed to fetch products: ${error.message}`, 500);
      }

      console.log('✅ [getProducts] Found', products?.length || 0, 'products');

      if (!products || products.length === 0) {
        console.log('ℹ️ [getProducts] No products in stock');
        return successResponse(res, [], 'No products currently available');
      }

      const commissionRates: Record<string, number> = {
        starter: 0.08,
        pro: 0.1,
        elite: 0.12,
      };

      const rate = commissionRates[affiliate.tier] || 0.08;
      console.log('💰 [getProducts] Using commission rate:', rate * 100, '%');

      const productsWithCommission = products.map(product => {
        // Use discount_price if available, fall back to price, default to 0
        const price = product.discount_price || product.price || 0;
        
        if (!price || price === 0) {
          console.warn('⚠️ [getProducts] Product', product.id, 'has no valid price (discount:', product.discount_price, 'price:', product.price, ')');
          return {
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            thumbnail: product.thumbnail,
            images: product.images,
            price: product.price || 0,
            originalPrice: product.price || 0,
            discountPrice: product.discount_price || 0,
            commissionRate: rate * 100,
            commission: 0,
            inStock: product.in_stock,
            stockQuantity: product.stock_quantity,
            categoryId: product.category_id,
            brandId: product.brand_id,
          };
        }
        
        return {
          id: product.id,
          name: product.name,
          slug: product.slug,
          description: product.description,
          thumbnail: product.thumbnail,
          images: product.images,
          price,
          originalPrice: product.price || 0,
          discountPrice: product.discount_price || 0,
          commissionRate: rate * 100,
          commission: parseFloat((price * rate).toFixed(2)),
          inStock: product.in_stock,
          stockQuantity: product.stock_quantity,
          categoryId: product.category_id,
          brandId: product.brand_id,
        };
      });

      console.log('✅ [getProducts] Mapped', productsWithCommission.length, 'products with commissions');
      return successResponse(res, productsWithCommission, 'Products with commissions retrieved');
    } catch (error) {
      console.error('❌ [getProducts] Unexpected error:', error instanceof Error ? error.message : error);
      if (error instanceof Error) {
        console.error('   Stack:', error.stack);
      }
      return errorResponse(res, 'Failed to fetch products', 500);
    }
  }

  /**
   * Get campaigns
   */
  async getCampaigns(req: any, res: Response) {
    try {
      const { status } = req.query;
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const campaigns = await affiliateService.getCampaigns(affiliate.id, status as string);
      return successResponse(res, campaigns, 'Campaigns retrieved successfully');
    } catch (error) {
      console.error('Campaigns error:', error);
      return errorResponse(res, 'Failed to fetch campaigns', 500);
    }
  }

  /**
   * Get campaign details
   */
  async getCampaign(req: any, res: Response) {
    try {
      const { id } = req.params;

      const campaign = await affiliateService.getCampaign(id);
      return successResponse(res, campaign, 'Campaign retrieved successfully');
    } catch (error) {
      console.error('Campaign error:', error);
      const message = error instanceof Error ? error.message : 'Failed to fetch campaign';
      return errorResponse(res, message, 400);
    }
  }

  /**
   * Get campaign statistics
   */
  async getCampaignStats(req: any, res: Response) {
    try {
      const { id } = req.params;
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const stats = await affiliateService.getCampaignStats(affiliate.id, id);
      return successResponse(res, stats, 'Campaign stats retrieved successfully');
    } catch (error) {
      console.error('Campaign stats error:', error);
      return errorResponse(res, 'Failed to fetch campaign stats', 500);
    }
  }

  /**
   * Get notifications
   */
  async getNotifications(req: any, res: Response) {
    try {
      const { limit = '10' } = req.query;

      const notifications = await affiliateService.getNotifications(
        req.user.id,
        parseInt(limit as string)
      );
      return successResponse(res, notifications, 'Notifications retrieved successfully');
    } catch (error) {
      console.error('Notifications error:', error);
      return errorResponse(res, 'Failed to fetch notifications', 500);
    }
  }

  /**
   * Get unread notification count
   */
  async getUnreadNotificationCount(req: any, res: Response) {
    try {
      const count = await affiliateService.getUnreadNotificationCount(req.user.id);
      return successResponse(res, { unreadCount: count }, 'Unread count retrieved');
    } catch (error) {
      console.error('Unread count error:', error);
      return errorResponse(res, 'Failed to fetch unread count', 500);
    }
  }

  /**
   * Mark notification as read
   */
  async markNotificationAsRead(req: any, res: Response) {
    try {
      const { id } = req.params;

      const notification = await affiliateService.markNotificationAsRead(req.user.id, id);
      return successResponse(res, notification, 'Notification marked as read');
    } catch (error) {
      console.error('Mark read error:', error);
      const message = error instanceof Error ? error.message : 'Failed to mark as read';
      return errorResponse(res, message, 400);
    }
  }

  /**
   * Get affiliate settings
   */
  async getAffiliateSettings(req: any, res: Response) {
    try {
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const settings = await affiliateService.getAffiliateSettings(affiliate.id);
      return successResponse(res, settings, 'Settings retrieved successfully');
    } catch (error) {
      console.error('Settings error:', error);
      return errorResponse(res, 'Failed to fetch settings', 500);
    }
  }

  /**
   * Update affiliate settings
   */
  async updateAffiliateSettings(req: any, res: Response) {
    try {
      const { emailNotifications, monthlyReports, autoWithdrawal, autoWithdrawalAmount } = req.body;

      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (!affiliate) {
        return errorResponse(res, 'Affiliate not found', 404);
      }

      const settings = await affiliateService.updateAffiliateSettings(affiliate.id, {
        emailNotifications,
        monthlyReports,
        autoWithdrawal,
        autoWithdrawalAmount,
      });

      return successResponse(res, settings, 'Settings updated successfully');
    } catch (error) {
      console.error('Update settings error:', error);
      const message = error instanceof Error ? error.message : 'Failed to update settings';
      return errorResponse(res, message, 400);
    }
  }

  /**
   * Get user profile
   */
  async getUserProfile(req: any, res: Response) {
    try {
      const profile = await affiliateService.getUserProfile(req.user.id);
      return successResponse(res, profile, 'Profile retrieved successfully');
    } catch (error) {
      console.error('Profile error:', error);
      return errorResponse(res, 'Failed to fetch profile', 500);
    }
  }

  /**
   * Update user profile
   */
  async updateUserProfile(req: any, res: Response) {
    try {
      const { firstName, lastName, phone, avatar, bio, country, city } = req.body;

      const profile = await affiliateService.updateUserProfile(req.user.id, {
        firstName,
        lastName,
        phone,
        avatar,
        bio,
        country,
        city,
      });

      return successResponse(res, profile, 'Profile updated successfully');
    } catch (error) {
      console.error('Update profile error:', error);
      const message = error instanceof Error ? error.message : 'Failed to update profile';
      return errorResponse(res, message, 400);
    }
  }

  /**
   * Get user affiliate tier
   */
  async getUserAffiliateTier(req: any, res: Response) {
    try {
      const tierInfo = await affiliateService.getUserAffiliateTier(req.user.id);
      return successResponse(res, tierInfo, 'Tier info retrieved successfully');
    } catch (error) {
      console.error('Tier info error:', error);
      return errorResponse(res, 'Failed to fetch tier info', 500);
    }
  }

  /**
   * Process pending payouts (admin endpoint)
   * Initiates Paystack transfers for all pending payout requests
   */
  async processPendingPayouts(req: any, res: Response) {
    try {
      console.log('🔄 [PAYOUT] Processing pending payouts...');

      // Get all pending payouts with their payment methods
      const pendingPayouts = await affiliatePayoutProcessor.getPendingPayouts();

      if (pendingPayouts.length === 0) {
        return successResponse(res, { processed: 0, failed: 0 }, 'No pending payouts to process');
      }

      let processed = 0;
      let failed = 0;
      const results = [];

      for (const payoutRequest of pendingPayouts) {
        try {
          const paymentMethod = normalizePaymentMethod(payoutRequest.payout_methods);

          console.log(`🔍 [PAYOUT] Payment method payload for payout ${payoutRequest.id}:`, paymentMethod);

          if (!paymentMethod) {
            console.error(`❌ [PAYOUT] No valid payment method found for payout ${payoutRequest.id}`);
            failed++;
            results.push({
              payoutId: payoutRequest.id,
              status: 'failed',
              error: 'Payment method not found',
            });
            continue;
          }

          const result = await affiliatePayoutProcessor.processPayout(payoutRequest, paymentMethod);
          processed++;
          results.push({
            payoutId: payoutRequest.id,
            status: 'success',
            reference: result.reference,
          });
        } catch (error: any) {
          console.error(`❌ [PAYOUT] Failed to process payout ${payoutRequest.id}:`, error.message);
          failed++;
          results.push({
            payoutId: payoutRequest.id,
            status: 'failed',
            error: error.message,
          });
        }
      }

      console.log(`✅ [PAYOUT] Batch processing complete: ${processed} processed, ${failed} failed`);

      return successResponse(
        res,
        { processed, failed, results },
        `Payout processing complete: ${processed} processed, ${failed} failed`
      );
    } catch (error: any) {
      console.error('❌ [PAYOUT] Batch processing error:', error.message);
      return errorResponse(res, 'Failed to process payouts', 500);
    }
  }

  /**
   * Verify payout status with Paystack
   */
  async verifyPayoutStatus(req: any, res: Response) {
    try {
      const { payoutId } = req.params;

      // Get payout details
      const { data: payout, error: payoutError } = await supabaseAdmin
        .from('payout_requests')
        .select('*')
        .eq('id', payoutId)
        .single();

      if (payoutError || !payout) {
        return errorResponse(res, 'Payout not found', 404);
      }

      if (!payout.reference) {
        return errorResponse(res, 'Payout has no Paystack reference yet', 400);
      }

      // Verify with Paystack
      const transferStatus = await affiliatePayoutProcessor.verifyTransferStatus(payout.reference);

      // Update payout status if needed
      if (transferStatus.status && transferStatus.status !== payout.status) {
        await affiliatePayoutProcessor.updatePayoutFromPaystack(payoutId, transferStatus.status);
      }

      return successResponse(
        res,
        {
          payoutId,
          reference: payout.reference,
          currentStatus: payout.status,
          paystackStatus: transferStatus.status,
          amount: payout.amount,
          reason: transferStatus.reason,
        },
        'Payout status verified'
      );
    } catch (error: any) {
      console.error('Verify payout error:', error.message);
      return errorResponse(res, 'Failed to verify payout status', 500);
    }
  }

  /**
   * Retry a failed payout
   */
  async retryFailedPayout(req: any, res: Response) {
    try {
      const { payoutId } = req.params;

      // Get payout details
      const { data: payout, error: payoutError } = await supabaseAdmin
        .from('payout_requests')
        .select(
          `
          id,
          affiliate_id,
          amount,
          payout_method_id,
          method,
          status,
          payout_methods (
            id,
            method_type,
            account_name,
            provider,
            is_default
          )
        `
        )
        .eq('id', payoutId)
        .single();

      if (payoutError || !payout) {
        return errorResponse(res, 'Payout not found', 404);
      }

      if (payout.status !== 'failed') {
        return errorResponse(res, `Cannot retry payout with status '${payout.status}'`, 400);
      }

      const paymentMethod = normalizePaymentMethod(payout.payout_methods);

      if (!paymentMethod) {
        return errorResponse(res, 'Payment method not found', 404);
      }

      console.log('🔍 [PAYOUT] Retry payment method:', paymentMethod);

      // Retry the payout
      const result = await affiliatePayoutProcessor.processPayout(payout, paymentMethod);

      return successResponse(
        res,
        {
          payoutId,
          reference: result.reference,
          amount: result.amount,
        },
        'Payout retry initiated successfully'
      );
    } catch (error: any) {
      console.error('Retry payout error:', error.message);
      return errorResponse(res, 'Failed to retry payout', 500);
    }
  }
}

export const affiliateController = new AffiliateController();