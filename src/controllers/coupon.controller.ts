import { Request, Response } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { AuthRequest } from '../middleware/auth.middleware';

export class CouponController {
  // Validate coupon code. The shopper id comes from their login, not the body.
  async validateCoupon(req: AuthRequest, res: Response) {
    try {
      const { code, cart_amount } = req.body;
      const cartAmount = Number(cart_amount);

      if (!code || !Number.isFinite(cartAmount) || cartAmount < 0) {
        return res.status(400).json({
          success: false,
          message: 'Coupon code and cart amount are required',
        });
      }

      // Call the database function
      const { data, error } = await supabaseAdmin.rpc('validate_coupon', {
        coupon_code: code,
        cart_amount: cartAmount,
        user_id_param: req.user?.id || null,
      });

      if (error) {
        console.error('Error validating coupon:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to validate coupon',
        });
      }

      if (!data || !data.is_valid) {
        return res.json({
          success: false,
          data: {
            is_valid: false,
            discount_amount: 0,
            error_message: data?.error_message || 'Invalid coupon code',
          },
        });
      }

      return res.json({
        success: true,
        data: {
          is_valid: true,
          discount_amount: Math.min(parseFloat(data.discount_amount) || 0, cartAmount),
          error_message: '',
          coupon_id: data.coupon_id,
          coupon_name: data.coupon_name,
          discount_type: data.discount_type,
          applies_to: data.applies_to,
        },
      });
    } catch (error: any) {
      console.error('Error validating coupon:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to validate coupon',
      });
    }
  }

  // Get all coupons (admin)
  async getAllCoupons(req: Request, res: Response) {
    try {
      const { data, error } = await supabaseAdmin
        .from('coupons')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return res.json({
        success: true,
        data: data || [],
      });
    } catch (error: any) {
      console.error('Error fetching coupons:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch coupons',
      });
    }
  }

  // Get coupon by ID (admin)
  async getCouponById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const { data, error } = await supabaseAdmin
        .from('coupons')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      return res.json({
        success: true,
        data,
      });
    } catch (error: any) {
      console.error('Error fetching coupon:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch coupon',
      });
    }
  }

  // Create coupon (admin)
  async createCoupon(req: Request, res: Response) {
    try {
      const {
        code,
        name,
        description,
        discount_type,
        discount_value,
        minimum_amount,
        maximum_discount,
        applies_to,
        usage_limit,
        per_user_limit,
        is_active,
        valid_from,
        valid_until,
      } = req.body;

      // Validate required fields
      if (!code || !name || !discount_type || discount_value === undefined) {
        return res.status(400).json({
          success: false,
          message: 'Code, name, discount_type, and discount_value are required',
        });
      }

      // Validate discount_type
      if (!['percentage', 'fixed_amount', 'free_shipping'].includes(discount_type)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid discount_type. Must be: percentage, fixed_amount, or free_shipping',
        });
      }

      const couponData: any = {
        code: code.toUpperCase().trim(),
        name,
        description: description || null,
        discount_type,
        discount_value: parseFloat(discount_value),
        minimum_amount: minimum_amount ? parseFloat(minimum_amount) : 0,
        maximum_discount: maximum_discount ? parseFloat(maximum_discount) : null,
        applies_to: applies_to || 'all',
        usage_limit: usage_limit ? parseInt(usage_limit) : null,
        per_user_limit: per_user_limit ? parseInt(per_user_limit) : 1,
        is_active: is_active !== undefined ? is_active : true,
        valid_from: valid_from || new Date().toISOString(),
        valid_until: valid_until || null,
      };

      const { data, error } = await supabaseAdmin
        .from('coupons')
        .insert([couponData])
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({
        success: true,
        message: 'Coupon created successfully',
        data,
      });
    } catch (error: any) {
      console.error('Error creating coupon:', error);
      
      // Handle duplicate code error
      if (error.code === '23505' || error.message?.includes('duplicate')) {
        return res.status(400).json({
          success: false,
          message: 'A coupon with this code already exists',
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to create coupon',
      });
    }
  }

  // Update coupon (admin)
  async updateCoupon(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Remove fields that shouldn't be updated directly
      delete updates.id;
      delete updates.created_at;
      delete updates.used_count; // This is managed by the system

      // Convert numeric fields
      if (updates.discount_value !== undefined) {
        updates.discount_value = parseFloat(updates.discount_value);
      }
      if (updates.minimum_amount !== undefined) {
        updates.minimum_amount = parseFloat(updates.minimum_amount);
      }
      if (updates.maximum_discount !== undefined) {
        updates.maximum_discount = updates.maximum_discount ? parseFloat(updates.maximum_discount) : null;
      }
      if (updates.usage_limit !== undefined) {
        updates.usage_limit = updates.usage_limit ? parseInt(updates.usage_limit) : null;
      }
      if (updates.per_user_limit !== undefined) {
        updates.per_user_limit = parseInt(updates.per_user_limit) || 1;
      }

      // Uppercase code if provided
      if (updates.code) {
        updates.code = updates.code.toUpperCase().trim();
      }

      const { data, error } = await supabaseAdmin
        .from('coupons')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return res.json({
        success: true,
        message: 'Coupon updated successfully',
        data,
      });
    } catch (error: any) {
      console.error('Error updating coupon:', error);
      
      if (error.code === '23505' || error.message?.includes('duplicate')) {
        return res.status(400).json({
          success: false,
          message: 'A coupon with this code already exists',
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to update coupon',
      });
    }
  }

  // Delete coupon (admin)
  async deleteCoupon(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const { error } = await supabaseAdmin
        .from('coupons')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return res.json({
        success: true,
        message: 'Coupon deleted successfully',
      });
    } catch (error: any) {
      console.error('Error deleting coupon:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete coupon',
      });
    }
  }
}

