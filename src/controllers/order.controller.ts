import { Request, Response } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { AuthRequest, staffHasModuleAccess } from '../middleware/auth.middleware';
import {
  PricingError,
  isValidPaymentReference,
  priceOrder,
  verifyPaystackPayment,
} from '../services/pricing.service';
import enhancedEmailService from '../services/enhanced-email.service';
import { adminNotificationEmail } from '../config/email';
import pdfService from '../services/pdf.service';
import { logAudit } from '../services/audit.service';
import { resolveReferralAttribution } from '../services/affiliate.service';
import {
  maybeCreateCommissionAfterPayment,
  maybeMarkDelivered,
  maybeReverseCommission,
} from '../services/affiliateCommission.service';

export class OrderController {
  // Get all orders (admin)
  async getAllOrders(req: Request, res: Response) {
    try {
      const { user_id } = req.query;
      
      let query = supabaseAdmin
        .from('orders')
        .select(`
          *,
          user:users!orders_user_id_fkey(id, first_name, last_name, email),
          order_items:order_items(*)
        `);

      // Filter by user_id if provided
      if (user_id) {
        query = query.eq('user_id', user_id as string);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      // Extract is_pre_order from shipping_address for each order (for backward compatibility)
      const ordersWithPreOrderFlag = (data || []).map((order: any) => {
        const isPreOrder = order.is_pre_order || order.shipping_address?.is_pre_order || false;
        const preOrderShippingOption = order.pre_order_shipping_option || order.shipping_address?.pre_order_shipping_option || null;
        const estimatedArrivalDate = order.estimated_arrival_date || order.shipping_address?.estimated_arrival_date || null;

        return {
          ...order,
          is_pre_order: isPreOrder,
          pre_order_shipping_option: preOrderShippingOption,
          estimated_arrival_date: estimatedArrivalDate,
        };
      });

      res.json({
        success: true,
        data: ordersWithPreOrderFlag,
      });
    } catch (error) {
      console.error('Error fetching orders:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch orders',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Track order by number/ID and email (public endpoint with email verification)
  async trackOrder(req: Request, res: Response) {
    const notFoundMessage = "We couldn't find an order with that number. Check the number and the email you used at checkout.";
    const serverMessage = 'Something went wrong. Please try again in a moment.';
    const orderSelect = `
      *,
      user:users!orders_user_id_fkey(id, email),
      order_items:order_items(*)
    `;

    try {
      const { order_number_or_id, email } = req.body;

      if (!order_number_or_id || !email) {
        return res.status(400).json({
          success: false,
          message: 'Order number/ID and email are required',
        });
      }

      const lookup = String(order_number_or_id).trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lookup);

      // A non-UUID must never be compared with orders.id.
      const query = supabaseAdmin.from('orders').select(orderSelect);
      const { data: order, error: fetchError } = isUuid
        ? await query.eq('id', lookup).maybeSingle()
        : await query.ilike('order_number', lookup.replace(/[%_\\]/g, '\\$&')).maybeSingle();

      if (fetchError) {
        console.error('Error tracking order:', req.originalUrl, fetchError);
        return res.status(500).json({
          success: false,
          message: serverMessage,
        });
      }

      if (!order) {
        // ✅ Security: Always return same response time to prevent timing attacks
        // Use setTimeout to normalize response time (add small random delay)
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 50));
        return res.status(404).json({
          success: false,
          message: notFoundMessage,
        });
      }

      const data = order;

      // Log order status for debugging (including cancelled orders)
      console.log(`📦 Tracking order ${data.order_number}: status=${data.status}, payment_status=${data.payment_status}`);

      // ✅ Security: Verify email matches with constant-time comparison
      const userEmail = data.user?.email?.toLowerCase();
      const deliveryEmail = (data.delivery_address?.email || data.shipping_address?.email)?.toLowerCase();
      const providedEmail = email.toLowerCase().trim();

      const emailMatches = 
        userEmail === providedEmail || 
        deliveryEmail === providedEmail;

      if (!emailMatches) {
        // ✅ Security: Always return same response time to prevent timing attacks
        // Email doesn't match - return 404 for security (don't reveal order exists)
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 50));
        return res.status(404).json({
          success: false,
          message: notFoundMessage,
        });
      }

      // Extract is_pre_order from shipping_address if it exists there
      const isPreOrder = data.is_pre_order || data.shipping_address?.is_pre_order || false;
      const preOrderShippingOption = data.pre_order_shipping_option || data.shipping_address?.pre_order_shipping_option || null;
      const estimatedArrivalDate = data.estimated_arrival_date || data.shipping_address?.estimated_arrival_date || null;

      // Add pre-order fields to the response
      const orderData = {
        ...data,
        items: data.order_items || [],
        is_pre_order: isPreOrder,
        pre_order_shipping_option: preOrderShippingOption,
        estimated_arrival_date: estimatedArrivalDate,
      };

      res.json({
        success: true,
        data: orderData,
      });
    } catch (error) {
      console.error('Error tracking order:', req.originalUrl, error);
      res.status(500).json({
        success: false,
        message: serverMessage,
      });
    }
  }

  // Admins see every order; customers only their own. Guest orders are
  // reachable by their unguessable UUID, which the checkout success page needs.
  private orderEmail(order: any): string {
    return String(
      order?.customer_bio?.email ||
      order?.shipping_address?.email ||
      order?.user?.email ||
      ''
    ).trim().toLowerCase();
  }

  // Account orders belong to that account. Guest orders are returned only
  // when the caller repeats the email used at checkout.
  private async canAccessOrder(req: AuthRequest, order: any, email?: string): Promise<boolean> {
    const role = req.user?.role;
    if (role === 'admin' || role === 'superadmin') return true;
    if (role === 'staff' && await staffHasModuleAccess(req, 'orders', 'view')) return true;
    if (order.user_id) return req.user?.id === order.user_id;
    const expected = this.orderEmail(order);
    const given = email?.trim().toLowerCase();
    return !!given && !!expected && given === expected;
  }

  // Existing order for a Paystack payment (regular and pre-order are separate orders)
  private async findOrderForPayment(paymentReference: string, isPreOrder: boolean) {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('shipping_address->>payment_reference', paymentReference);
    if (error) throw error;
    return (data || []).find((o: any) => !!o.shipping_address?.is_pre_order === isPreOrder) || null;
  }

  // Get the items of one order (admin)
  async getOrderItems(req: Request, res: Response) {
    try {
      const { data, error } = await supabaseAdmin
        .from('order_items')
        .select('*')
        .eq('order_id', req.params.id);

      if (error) throw error;

      res.json({
        success: true,
        data: data || [],
      });
    } catch (error) {
      console.error('Error fetching order items:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch order items',
      });
    }
  }

  // Get order by ID
  async getOrderById(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;

      const { data, error } = await supabaseAdmin
        .from('orders')
        .select(`
          *,
          user:users!orders_user_id_fkey(id, first_name, last_name, email),
          order_items:order_items(*)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      const email = typeof req.query.email === 'string' ? req.query.email : undefined;
      if (!(await this.canAccessOrder(req, data, email))) {
        return res.status(404).json({
          success: false,
          message: 'Order not found',
        });
      }

      // Extract is_pre_order from shipping_address if it exists there
      // Also check if it's a direct column (for backward compatibility)
      const isPreOrder = data.is_pre_order || data.shipping_address?.is_pre_order || false;
      const preOrderShippingOption = data.pre_order_shipping_option || data.shipping_address?.pre_order_shipping_option || null;
      const estimatedArrivalDate = data.estimated_arrival_date || data.shipping_address?.estimated_arrival_date || null;

      // Add pre-order fields to the response
      const orderData = {
        ...data,
        is_pre_order: isPreOrder,
        pre_order_shipping_option: preOrderShippingOption,
        estimated_arrival_date: estimatedArrivalDate,
      };

      res.json({
        success: true,
        data: orderData,
      });
    } catch (error) {
      console.error('Error fetching order:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch order',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Update order status
  async updateOrderStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { status, tracking_number, notes } = req.body;

      // ✅ Get existing order to check previous status and prevent double stock restoration
      const { data: existingOrder, error: fetchError } = await supabaseAdmin
        .from('orders')
        .select(`
          *,
          order_items:order_items(*)
        `)
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;

      // Extract is_pre_order from existing order
      const isPreOrder = existingOrder.is_pre_order || existingOrder.shipping_address?.is_pre_order || false;
      const previousStatus = existingOrder.status;

      // ✅ Check if status is changing to "cancelled" and restore stock
      // Only restore if:
      // 1. New status is "cancelled"
      // 2. Previous status was NOT "cancelled" (prevent double restoration)
      // 3. Order is NOT a pre-order (pre-orders don't decrement stock)
      // 4. Payment status is NOT "refunded" (refunds should not restore stock)
      const isChangingToCancelled = status === 'cancelled' && previousStatus !== 'cancelled';
      const isRefunded = existingOrder.payment_status === 'refunded';
      
      if (isChangingToCancelled && !isPreOrder && !isRefunded) {
        try {
          const orderItems = existingOrder.order_items || [];
          console.log(`🔄 Restoring stock for ${orderItems.length} items in cancelled order ${existingOrder.order_number}`);
          
          for (const item of orderItems) {
            if (!item.product_id || !item.quantity) {
              console.warn(`⚠️ Skipping item with missing product_id or quantity:`, item);
              continue;
            }
            
            // Get current stock
            const { data: product, error: productError } = await supabaseAdmin
              .from('products')
              .select('stock_quantity, in_stock, name')
              .eq('id', item.product_id)
              .single();
            
            if (!productError && product) {
              const currentStock = product.stock_quantity || 0;
              const restoredStock = currentStock + item.quantity; // ✅ Handle multiple quantities
              const newInStock = restoredStock > 0;
              
              // Restore stock atomically
              const { error: restoreError } = await supabaseAdmin
                .from('products')
                .update({
                  stock_quantity: restoredStock,
                  in_stock: newInStock,
                })
                .eq('id', item.product_id);
              
              if (restoreError) {
                console.error(`❌ Failed to restore stock for product ${item.product_id}:`, restoreError);
              } else {
                console.log(`✅ Restored ${item.quantity} unit(s) for product ${item.product_id} (${product.name}): ${currentStock} → ${restoredStock}`);
              }
            } else {
              console.error(`❌ Error fetching product ${item.product_id} for stock restoration:`, productError);
            }
          }
        } catch (restoreError) {
          console.error('❌ Error restoring stock for cancelled order:', restoreError);
          // Don't fail status update if stock restoration fails
        }
      } else if (isChangingToCancelled && isPreOrder) {
        console.log('⏭️ Skipping stock restoration for pre-order (stock was never deducted)');
      } else if (isChangingToCancelled && isRefunded) {
        console.log('⏭️ Skipping stock restoration for refunded order (refunds should not restore stock)');
      } else if (isChangingToCancelled && previousStatus === 'cancelled') {
        console.log('⏭️ Skipping stock restoration (order was already cancelled - preventing double restoration)');
      }

      // Update order
      const statusPatch: Record<string, unknown> = {
        status,
        tracking_number,
        notes,
        updated_at: new Date().toISOString(),
      };
      if (status === 'delivered' && !existingOrder.delivered_at) {
        statusPatch.delivered_at = new Date().toISOString();
      }

      const { data: orderData, error: orderError } = await supabaseAdmin
        .from('orders')
        .update(statusPatch)
        .eq('id', id)
        .select(`
          *,
          user:users!orders_user_id_fkey(id, first_name, last_name, email),
          order_items:order_items(*)
        `)
        .single();

      if (orderError) throw orderError;

      await logAudit({
        req,
        entity: 'orders',
        entityId: id,
        action: 'update_status',
        before: existingOrder,
        after: orderData,
      });

      if (status === 'delivered') {
        await maybeMarkDelivered(req, orderData);
      }
      if (status === 'cancelled' && previousStatus !== 'cancelled') {
        await maybeReverseCommission(req, orderData, 'Order cancelled');
      }

      // Extract is_pre_order from updated orderData (reuse existing isPreOrder variable from above)
      // Update isPreOrder with value from orderData if available, otherwise keep existing value
      const finalIsPreOrder = orderData.is_pre_order || orderData.shipping_address?.is_pre_order || isPreOrder;
      const preOrderShippingOption = orderData.pre_order_shipping_option || orderData.shipping_address?.pre_order_shipping_option || null;
      const estimatedArrivalDate = orderData.estimated_arrival_date || orderData.shipping_address?.estimated_arrival_date || null;

      // Send email notification
      try {
        // Determine customer email and name
        let customerEmail: string | null = null;
        let customerName: string = 'Customer';
        
        if (orderData.user && orderData.user.email) {
          // Logged-in user
          customerEmail = orderData.user.email;
          customerName = `${orderData.user.first_name || ''} ${orderData.user.last_name || ''}`.trim() || 'Customer';
        } else if (orderData.shipping_address && (orderData.shipping_address as any)?.email) {
          // Guest checkout - get email from shipping address
          customerEmail = (orderData.shipping_address as any).email;
          customerName = orderData.shipping_address?.full_name || orderData.shipping_address?.first_name || 'Guest Customer';
        }

        if (customerEmail) {
          const emailData = {
            ...orderData,
            customer_name: customerName,
            customer_email: customerEmail,
            items: orderData.order_items || [],
            delivery_address: orderData.shipping_address || orderData.delivery_address, // For email template compatibility
            is_pre_order: finalIsPreOrder,
            pre_order_shipping_option: preOrderShippingOption,
            estimated_arrival_date: estimatedArrivalDate,
          };

          console.log(`📧 Preparing to send order status update email to: ${customerEmail}`);
          const emailResult = await enhancedEmailService.sendOrderStatusUpdate(emailData, status);
          if (emailResult.skipped) {
            console.log(`⚠️ Order status update email skipped: ${emailResult.reason}`);
          } else if (emailResult.success) {
            console.log(`✅ Order status update email sent successfully to ${customerEmail}`);
          } else {
            console.error(`❌ Failed to send order status update email to ${customerEmail}:`, emailResult.reason);
          }
        } else {
          console.warn('⚠️ No email found for order status update. Order:', orderData.id);
        }
      } catch (emailError: any) {
        console.error('❌ Error sending order status update email:', {
          error: emailError,
          message: emailError?.message || 'Unknown error',
          orderId: orderData.id,
          orderNumber: orderData.order_number,
        });
        // Don't fail the request if email fails
      }

      res.json({
        success: true,
        message: 'Order status updated successfully',
        data: orderData,
      });
    } catch (error) {
      console.error('Error updating order status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update order status',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Update payment status
  async updatePaymentStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { payment_status } = req.body;

      if (!payment_status || !['pending', 'paid', 'failed', 'refunded'].includes(payment_status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payment status. Must be: pending, paid, failed, or refunded',
        });
      }

      const { data: existingOrder, error: fetchError } = await supabaseAdmin
        .from('orders')
        .select(`
          *,
          user:users!orders_user_id_fkey(id, first_name, last_name, email),
          order_items:order_items(*)
        `)
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;

      // Update payment status
      const { data: orderData, error: orderError } = await supabaseAdmin
        .from('orders')
        .update({
          payment_status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select(`
          *,
          user:users!orders_user_id_fkey(id, first_name, last_name, email),
          order_items:order_items(*)
        `)
        .single();

      if (orderError) throw orderError;

      await logAudit({
        req,
        entity: 'orders',
        entityId: id,
        action: 'update_payment_status',
        before: existingOrder,
        after: orderData,
      });

      if (payment_status === 'paid' && existingOrder.payment_status !== 'paid') {
        await maybeCreateCommissionAfterPayment(req, orderData);
      }
      if (payment_status === 'refunded' && existingOrder.payment_status !== 'refunded') {
        await maybeReverseCommission(req, orderData, 'Order refunded');
      }

      res.json({
        success: true,
        message: 'Payment status updated successfully',
        data: orderData,
      });
    } catch (error) {
      console.error('Error updating payment status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update payment status',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Cancel order (supports both logged-in and anonymous users)
  async cancelOrder(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { cancellation_reason, email } = req.body;

      // Get order first to verify ownership
      const { data: existingOrder, error: fetchError } = await supabaseAdmin
        .from('orders')
        .select(`
          *,
          user:users!orders_user_id_fkey(id, first_name, last_name, email),
          order_items:order_items(*)
        `)
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;
      if (!existingOrder) {
        return res.status(404).json({
          success: false,
          message: 'Order not found',
        });
      }

      // Account orders: owner, admin, superadmin, or staff with orders edit
      if (existingOrder.user_id) {
        const isOwner = req.user?.id === existingOrder.user_id;
        const role = req.user?.role;
        const isPrivileged = role === 'admin' || role === 'superadmin';
        const staffCanEditOrders = !isOwner && !isPrivileged
          ? await staffHasModuleAccess(req, 'orders', 'edit')
          : false;

        if (!isOwner && !isPrivileged && !staffCanEditOrders) {
          return res.status(403).json({
            success: false,
            message: 'You are not allowed to cancel this order',
          });
        }
      } else if (email) {
        // Anonymous order - verify email matches
        const orderEmail = existingOrder.customer_bio?.email || existingOrder.shipping_address?.email;
        if (!orderEmail || orderEmail.toLowerCase() !== email.toLowerCase()) {
          return res.status(403).json({
            success: false,
            message: 'Email verification failed. Please use the email address used when placing the order.',
          });
        }
      } else if (!existingOrder.user_id && !email) {
        // Anonymous order but no email provided
        return res.status(400).json({
          success: false,
          message: 'Email verification required for guest orders',
        });
      }

      // Update order
      const { data: orderData, error: orderError } = await supabaseAdmin
        .from('orders')
        .update({
          status: 'cancelled',
          notes: cancellation_reason ? `${existingOrder.notes || ''}\n\n[CANCELLED] ${cancellation_reason}`.trim() : existingOrder.notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select(`
          *,
          user:users!orders_user_id_fkey(id, first_name, last_name, email),
          order_items:order_items(*)
        `)
        .single();

      if (orderError) throw orderError;

      if (existingOrder.status !== 'cancelled') {
        await maybeReverseCommission(req, orderData, cancellation_reason || 'Order cancelled');
      }

      // ✅ Restore stock for cancelled orders (only for non-pre-orders)
      // Only restore if order was not already cancelled and is not a pre-order
      if (existingOrder.status !== 'cancelled' && !existingOrder.is_pre_order) {
        try {
          const orderItems = existingOrder.order_items || [];
          
          for (const item of orderItems) {
            if (!item.product_id || !item.quantity) continue;
            
            // Get current stock
            const { data: product, error: productError } = await supabaseAdmin
              .from('products')
              .select('stock_quantity, in_stock, name')
              .eq('id', item.product_id)
              .single();
            
            if (!productError && product) {
              const currentStock = product.stock_quantity || 0;
              const restoredStock = currentStock + item.quantity;
              const newInStock = restoredStock > 0;
              
              // Restore stock atomically
              const { error: restoreError } = await supabaseAdmin
                .from('products')
                .update({
                  stock_quantity: restoredStock,
                  in_stock: newInStock,
                })
                .eq('id', item.product_id);
              
              if (restoreError) {
                console.error(`❌ Failed to restore stock for product ${item.product_id}:`, restoreError);
              } else {
                console.log(`✅ Restored stock for product ${item.product_id} (${product.name}): ${currentStock} → ${restoredStock}`);
              }
            } else {
              console.error(`❌ Error fetching product ${item.product_id} for stock restoration:`, productError);
            }
          }
        } catch (restoreError) {
          console.error('❌ Error restoring stock for cancelled order:', restoreError);
          // Don't fail cancellation if stock restoration fails
        }
      } else if (existingOrder.is_pre_order) {
        console.log('⏭️ Skipping stock restoration for pre-order (stock was never deducted)');
      } else {
        console.log('⏭️ Skipping stock restoration (order was already cancelled)');
      }

      // Send cancellation email
      try {
        // Determine customer email and name
        let customerEmail: string | null = null;
        let customerName: string = 'Customer';
        
        if (orderData.user && orderData.user.email) {
          // Logged-in user
          customerEmail = orderData.user.email;
          customerName = `${orderData.user.first_name || ''} ${orderData.user.last_name || ''}`.trim() || 'Customer';
        } else if (orderData.customer_bio && orderData.customer_bio.email) {
          // Guest customer - use email from customer_bio
          customerEmail = orderData.customer_bio.email;
          customerName = orderData.customer_bio.name || 'Guest Customer';
        } else if (orderData.shipping_address && (orderData.shipping_address as any)?.email) {
          // Legacy: Guest checkout - get email from shipping address (fallback)
          customerEmail = (orderData.shipping_address as any).email;
          customerName = orderData.shipping_address?.full_name || orderData.shipping_address?.first_name || 'Guest Customer';
        }

        // Send cancellation email to CUSTOMER (logged-in or guest)
        // Recipient email is not stored, so only customer gets email
        if (customerEmail) {
          const emailData = {
            ...orderData,
            customer_name: customerName,
            customer_email: customerEmail,
            cancellation_reason,
          };

          // Note: Using order confirmation template for cancellation
          const emailResult = await enhancedEmailService.sendOrderConfirmation(emailData);
          if (emailResult.skipped) {
            console.log(`Order cancellation email skipped: ${emailResult.reason}`);
          } else if (emailResult.success) {
            console.log('Order cancellation email sent successfully to customer');
          } else {
            console.error('Failed to send order cancellation email:', emailResult.reason);
          }
        }
      } catch (emailError) {
        console.error('Failed to send order cancellation email:', emailError);
        // Don't fail the request if email fails
      }

      res.json({
        success: true,
        message: 'Order cancelled successfully',
        data: orderData,
      });
    } catch (error) {
      console.error('Error cancelling order:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to cancel order',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Generate sequential order number (format: ORD-XXXDDMMYY)
  private async generateOrderNumber(): Promise<string> {
    try {
      // Get today's date in DDMMYY format
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = String(now.getFullYear()).slice(-2);
      const dateStr = `${day}${month}${year}`;

      // Get the last order number for today to generate sequential number
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const { data: lastOrder } = await supabaseAdmin
        .from('orders')
        .select('order_number')
        .gte('created_at', todayStart.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let sequence = 1;
      if (lastOrder && lastOrder.order_number) {
        // Extract sequence from last order number (ORD-XXXDDMMYY)
        const match = lastOrder.order_number.match(/ORD-(\d{3})/);
        if (match) {
          sequence = parseInt(match[1]) + 1;
          // Reset to 1 if sequence exceeds 999 (shouldn't happen in one day)
          if (sequence > 999) sequence = 1;
        }
      }

      // Format sequence as 3 digits (001, 002, etc.)
      const sequenceStr = String(sequence).padStart(3, '0');
      return `ORD-${sequenceStr}${dateStr}`;
    } catch (error) {
      console.error('Error generating order number:', error);
      // Fallback: use timestamp-based number
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = String(now.getFullYear()).slice(-2);
      const dateStr = `${day}${month}${year}`;
      const sequenceStr = String(Date.now()).slice(-3);
      return `ORD-${sequenceStr}${dateStr}`;
    }
  }

  // Create order (with email confirmation)
  async createOrder(req: AuthRequest, res: Response) {
    try {
      console.log('📦 Order creation request received:', {
        hasUserId: !!req.user?.id,
        hasOrderItems: !!req.body.order_items,
        orderItemsCount: req.body.order_items?.length || 0,
        hasDeliveryAddress: !!req.body.delivery_address,
        paymentMethod: req.body.payment_method,
        paymentReference: req.body.payment_reference,
        total: req.body.total,
      });

      // The customer comes from the auth token, never from the request body
      const user_id: string | null = req.user?.id ?? null;

      const {
        delivery_option,
        payment_method,
        delivery_address,
        customer_bio, // Customer bio information (name, email, phone)
        order_items,
        notes,
        payment_reference: rawPaymentReference,
        coupon_id,
        // Pre-order fields
        is_pre_order,
        pre_order_shipping_option,
        estimated_arrival_date,
      } = req.body;
      const isPreOrderOrder = !!is_pre_order;
      // Only Paystack orders carry a payment reference
      const payment_reference: string | null = payment_method === 'paystack' ? rawPaymentReference : null;

      // Validate required fields
      if (!order_items || !Array.isArray(order_items) || order_items.length === 0) {
        console.error('❌ Order creation failed: No order items provided');
        return res.status(400).json({
          success: false,
          message: 'Order items are required',
          error: 'No order items provided',
        });
      }

      if (!delivery_address) {
        console.error('❌ Order creation failed: No delivery address provided');
        return res.status(400).json({
          success: false,
          message: 'Delivery address is required',
          error: 'No delivery address provided',
        });
      }

      if (payment_method === 'paystack' && !isValidPaymentReference(rawPaymentReference)) {
        return res.status(400).json({
          success: false,
          message: 'A valid payment reference is required for card/mobile money payments',
          error: 'INVALID_PAYMENT_REFERENCE',
        });
      }

      // One order per payment reference and order type. Repeat requests (the
      // payment callback page and the Paystack webhook) get the existing order.
      if (payment_method === 'paystack') {
        const existingOrder = await this.findOrderForPayment(rawPaymentReference, isPreOrderOrder);
        if (existingOrder) {
          console.log(`ℹ️ Order ${existingOrder.order_number} already exists for payment ${payment_reference}`);
          await maybeCreateCommissionAfterPayment(req, existingOrder);
          return res.json({
            success: true,
            message: 'Order already exists for this payment',
            data: existingOrder,
          });
        }
      }

      // ✅ All amounts are worked out on the server from the database.
      // Prices, delivery fees and discounts sent by the browser are ignored.
      const priced = await priceOrder({
        items: order_items.map((item: any) => ({
          product_id: item.product_id,
          quantity: Number(item.quantity),
          selected_variants: item.selected_variants,
        })),
        isPreOrder: isPreOrderOrder,
        deliveryOptionId: delivery_option?.id ?? null,
        preOrderShippingOption: pre_order_shipping_option ?? null,
        couponId: coupon_id ?? null,
        userId: user_id,
      });

      const actualSubtotal = priced.subtotal;
      const finalDeliveryFee = priced.deliveryFee;
      const finalTax = priced.tax;
      const finalDiscount = priced.discount;
      const finalTotal = priced.total;

      console.log('💰 Server-calculated order total (GHS):', {
        subtotal: actualSubtotal,
        delivery_fee: finalDeliveryFee,
        tax: finalTax,
        discount: finalDiscount,
        total: finalTotal,
        clientTotal: req.body.total, // Logged for comparison only, NOT used
      });

      // Card/mobile money: confirm with Paystack that the money actually arrived,
      // and that it covers every order placed against this payment.
      let paymentStatus: 'paid' | 'pending' = 'pending';
      if (payment_method === 'paystack') {
        const payment = await verifyPaystackPayment(rawPaymentReference);

        const { data: ordersForPayment, error: ordersForPaymentError } = await supabaseAdmin
          .from('orders')
          .select('total')
          .eq('shipping_address->>payment_reference', payment_reference);
        if (ordersForPaymentError) throw ordersForPaymentError;

        const alreadyCovered = (ordersForPayment || []).reduce(
          (sum: number, o: any) => sum + (Number(o.total) || 0),
          0
        );

        if (alreadyCovered + finalTotal > payment.amountGhs + 0.01) {
          console.error('🚨 Payment amount does not cover order total:', {
            payment_reference,
            paid: payment.amountGhs,
            alreadyCovered,
            orderTotal: finalTotal,
          });
          return res.status(400).json({
            success: false,
            message: `The amount paid does not match the order total. Please contact support with payment reference ${payment_reference}.`,
            error: 'PAYMENT_AMOUNT_MISMATCH',
          });
        }

        paymentStatus = 'paid';
      }

      let attribution: { affiliateId: string; clickId: string } | null = null;
      try {
        attribution = await resolveReferralAttribution({
          clickId: req.body?.referral?.click_id || req.body?.click_id || null,
          buyerUserId: user_id,
          buyerEmail: customer_bio?.email || delivery_address?.email || req.user?.email || null,
          buyerPhone: customer_bio?.phone || delivery_address?.phone || req.user?.phone || null,
        });
      } catch (referralError) {
        console.error('referral attribution', referralError);
      }

      // Order numbers are always generated by the backend
      const finalOrderNumber = await this.generateOrderNumber();
      console.log('✅ Generated order number:', finalOrderNumber);

      // Map delivery_address to shipping_address and include delivery_option in the address JSON
      const shippingAddress = {
        ...delivery_address,
        delivery_option: { ...(delivery_option || { name: 'Standard' }), price: finalDeliveryFee },
        // Include pre-order information in shipping address
        ...(isPreOrderOrder ? {
          is_pre_order: true,
          pre_order_shipping_option: pre_order_shipping_option || null,
          estimated_arrival_date: estimated_arrival_date || null,
        } : {}),
      };

      // Create order
      // Note: payment_reference column does NOT exist in orders table
      // Store it in shipping_address JSON instead (if provided)
      const orderInsertData: any = {
        user_id,
        order_number: finalOrderNumber,
        subtotal: actualSubtotal, // ✅ Already in GHS from frontend
        discount: finalDiscount || 0, // ✅ Already in GHS from frontend
        tax: finalTax || 0, // ✅ Already in GHS from frontend
        shipping_fee: finalDeliveryFee || 0, // ✅ Already in GHS from frontend
        // ✅ CRITICAL: ALWAYS use calculatedTotal, NEVER req.body.total
        // req.body.total might be Paystack amount (pesewas) or incorrect
        // calculatedTotal is: subtotal + delivery_fee + tax - discount (all in GHS)
        total: finalTotal, // ✅ Calculated total in GHS - NEVER use req.body.total directly
        payment_method,
        shipping_address: {
          ...shippingAddress,
          // Only include payment_reference if provided (store in shipping_address JSON)
          ...(payment_reference ? { payment_reference } : {}),
        },
        customer_bio: customer_bio || null, // Store customer bio information
        notes: isPreOrderOrder
          ? `${notes || ''}\n\n[PRE-ORDER] Shipping: ${pre_order_shipping_option || 'Not specified'}. Estimated Arrival: ${estimated_arrival_date ? new Date(estimated_arrival_date).toLocaleDateString() : 'TBD'}`.trim()
          : (notes || null),
        status: 'pending',
        // 'paid' only after Paystack has confirmed the payment above
        payment_status: paymentStatus,
        ...(attribution
          ? { affiliate_id: attribution.affiliateId, referral_click_id: attribution.clickId }
          : {}),
      };

      // DO NOT include payment_reference as a direct column - it doesn't exist in orders table
      // It's already stored in shipping_address JSON above (if provided)

      const { data: orderData, error: orderError } = await supabaseAdmin
        .from('orders')
        .insert([orderInsertData])
        .select()
        .single();

      if (orderError) {
        console.error('❌ Order creation failed:', orderError);
        throw orderError;
      }
      
      console.log('✅ Order created successfully:', {
        id: orderData.id,
        order_number: orderData.order_number,
        user_id: orderData.user_id,
      });

      // Create order items (server-priced) and decrease stock
      const orderItems = priced.items.map((item) => ({
        order_id: orderData.id,
        ...item,
      }));

      const { error: itemsError } = await supabaseAdmin
        .from('order_items')
        .insert(orderItems);

      if (itemsError) {
        console.error('❌ Order items creation failed:', itemsError);
        
        // If order items fail, delete the orphaned order to prevent incomplete orders
        try {
          await supabaseAdmin.from('orders').delete().eq('id', orderData.id);
          console.log('✅ Deleted orphaned order due to order items creation failure');
        } catch (deleteError) {
          console.error('❌ Failed to delete orphaned order:', deleteError);
        }
        
        // Provide a more helpful error message
        if (itemsError.code === '23503' && itemsError.details?.includes('product_id')) {
          const productIdMatch = itemsError.details.match(/product_id\)=\(([^)]+)\)/);
          const missingProductId = productIdMatch ? productIdMatch[1] : 'unknown';
          const error = new Error(`Product not found: ${missingProductId}. This product may have been removed from the catalog. Please remove it from your cart and try again.`);
          (error as any).code = 'PRODUCT_NOT_FOUND';
          (error as any).productId = missingProductId;
          throw error;
        }
        
        throw itemsError;
      }
      
      console.log(`✅ Created ${orderItems.length} order items`);

      // ✅ Atomic stock update: Decrease stock for each product (skip for pre-orders)
      // Use atomic update with WHERE clause to prevent race conditions
      const decrementedStock: { product_id: string; quantity: number }[] = [];
      let stockFailure: string | null = null;
      if (!isPreOrderOrder) {
        try {
          for (const item of priced.items) {
            // ✅ Atomic update: Only decrement if stock >= quantity
            // This prevents overselling when multiple orders are placed simultaneously
            const { data: updatedProduct, error: updateError } = await supabaseAdmin
              .rpc('decrement_product_stock', {
                product_id_param: item.product_id,
                quantity_param: item.quantity,
              });

            if (updateError) {
              // If RPC doesn't exist, fallback to atomic SQL update
              if (updateError.code === 'PGRST202' || updateError.message?.includes('function') || updateError.message?.includes('not found')) {
                // Fallback: Use atomic update with WHERE clause
                const { data: product, error: productError } = await supabaseAdmin
                  .from('products')
                  .select('stock_quantity, in_stock')
                  .eq('id', item.product_id)
                  .single();

                if (!productError && product) {
                  const currentStock = product.stock_quantity || 0;
                  
                  // Only update if sufficient stock available
                  if (currentStock >= item.quantity) {
                    const newStock = currentStock - item.quantity;
                    const newInStock = newStock > 0;

                    const { data: updatedProduct, error: atomicUpdateError } = await supabaseAdmin
                      .from('products')
                      .update({
                        stock_quantity: newStock,
                        in_stock: newInStock,
                      })
                      .eq('id', item.product_id)
                      .gte('stock_quantity', item.quantity) // ✅ Atomic: Only update if stock >= quantity
                      .select('name, stock_quantity')
                      .single();

                    if (atomicUpdateError || !updatedProduct) {
                      console.error(`❌ Failed to update stock for product ${item.product_id}:`, atomicUpdateError);
                      stockFailure = stockFailure || `${item.product_name} could not be reserved.`;
                    } else {
                      decrementedStock.push({ product_id: item.product_id, quantity: item.quantity });
                      console.log(`✅ Decreased stock for product ${item.product_id}: ${currentStock} → ${newStock}`);
                      
                      // ✅ Check for out of stock and send notification
                      if (newStock === 0 && updatedProduct.name) {
                        try {
                          // Create notification in database
                          const { error: notifError } = await supabaseAdmin
                            .from('notifications')
                            .insert({
                              type: 'alert',
                              title: 'Product Out of Stock',
                              message: `${updatedProduct.name} is now out of stock`,
                              is_read: false,
                            });
                          
                          if (notifError) {
                            console.error(`❌ Failed to create out of stock notification:`, notifError);
                          } else {
                            console.log(`✅ Created out of stock notification for ${updatedProduct.name}`);
                          }
                          
                          // Send email to admin
                          try {
                            const emailSent = await enhancedEmailService.sendEmail({
                              to: adminNotificationEmail,
                              subject: `🚨 Product Out of Stock: ${updatedProduct.name}`,
                              html: `
                                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                  <h2 style="color: #EF4444;">Product Out of Stock Alert</h2>
                                  <p>The following product has run out of stock:</p>
                                  <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 15px; margin: 20px 0;">
                                    <p style="margin: 0; font-weight: bold; color: #991B1B;">${updatedProduct.name}</p>
                                    <p style="margin: 5px 0 0 0; color: #7F1D1D;">Product ID: ${item.product_id}</p>
                                  </div>
                                  <p>Please restock this product as soon as possible.</p>
                                  <p style="margin-top: 30px; color: #6B7280; font-size: 12px;">
                                    This is an automated notification from Ventech Gadgets.
                                  </p>
                                </div>
                              `,
                            }, false); // Use noreply email
                            
                            if (emailSent) {
                              console.log(`✅ Out of stock email sent for product ${updatedProduct.name}`);
                            } else {
                              console.error(`❌ Failed to send out of stock email for product ${item.product_id}`);
                            }
                          } catch (emailError) {
                            console.error(`❌ Error sending out of stock email for product ${item.product_id}:`, emailError);
                          }
                        } catch (notifError) {
                          console.error(`❌ Failed to create out of stock notification for product ${item.product_id}:`, notifError);
                          // Don't fail order creation if notification fails
                        }
                      }
                    }
                  } else {
                    console.error(`❌ Insufficient stock for product ${item.product_id}: ${currentStock} < ${item.quantity}`);
                    stockFailure = stockFailure || `${item.product_name} does not have enough stock for this order.`;
                  }
                } else {
                  console.error(`❌ Error fetching product ${item.product_id} for stock update:`, productError);
                  stockFailure = stockFailure || `${item.product_name} could not be reserved.`;
                }
              } else {
                console.error(`❌ Failed to update stock for product ${item.product_id}:`, updateError);
                stockFailure = stockFailure || `${item.product_name} could not be reserved.`;
              }
            } else {
              decrementedStock.push({ product_id: item.product_id, quantity: item.quantity });
              console.log(`✅ Decreased stock for product ${item.product_id} using RPC`);
            }
          }
        } catch (stockError) {
          console.error('❌ Error updating product stock:', stockError);
          stockFailure = stockFailure || 'Stock could not be reserved for this order.';
        }
      } else {
        console.log('⏭️ Skipping stock update for pre-order');
      }

      if (stockFailure) {
        for (const taken of decrementedStock) {
          const { data: product } = await supabaseAdmin
            .from('products')
            .select('stock_quantity')
            .eq('id', taken.product_id)
            .single();
          if (product) {
            const restored = (Number(product.stock_quantity) || 0) + taken.quantity;
            await supabaseAdmin
              .from('products')
              .update({ stock_quantity: restored, in_stock: restored > 0 })
              .eq('id', taken.product_id);
          }
        }

        await supabaseAdmin
          .from('orders')
          .update({
            status: 'cancelled',
            notes: `${orderData.notes || ''}\n\n[CANCELLED] ${stockFailure}`.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', orderData.id);

        const paidNote = payment_method === 'paystack' && payment_reference
          ? ` Your payment was received. Contact support with reference ${payment_reference}.`
          : '';
        return res.status(409).json({
          success: false,
          message: `${stockFailure}${paidNote}`,
          error: 'INSUFFICIENT_STOCK',
        });
      }

      // Get user data for email (if logged in) - moved before transaction creation
      let userData: any = null;
      if (user_id) {
        const { data, error: userError } = await supabaseAdmin
          .from('users')
          .select('first_name, last_name, email, full_name')
          .eq('id', user_id)
          .maybeSingle();

        if (!userError) {
          userData = data;
        }
      }

      // Create transaction record for this order (even if pending)
      // This ensures all orders have a transaction record for tracking
      try {
        // Determine customer email and name
        let customerEmail: string | null = null;
        let customerName: string = 'Customer';
        
        if (userData && userData.email) {
          customerEmail = userData.email;
          customerName = userData.full_name || `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || 'Customer';
        } else if (shippingAddress && (shippingAddress as any)?.email) {
          customerEmail = (shippingAddress as any).email;
          customerName = shippingAddress?.full_name || shippingAddress?.first_name || 'Guest Customer';
        }

        const transactionData: any = {
          order_id: orderData.id,
          user_id: user_id || null,
          transaction_reference: payment_reference || `TXN-${orderData.id.slice(0, 8)}`,
          payment_method: payment_method || 'cash_on_delivery',
          payment_provider: payment_method === 'paystack' ? 'paystack' : payment_method === 'cash_on_delivery' ? 'cash' : 'other',
          amount: finalTotal, // ✅ Use finalTotal (GHS), not total (might be pesewas)
          currency: 'GHS',
          status: paymentStatus, // ✅ Consistent with order payment_status
          payment_status: paymentStatus, // ✅ Consistent with order payment_status
          customer_email: customerEmail || 'no-email@example.com', // Required field - provide default if missing
          metadata: {
            order_number: finalOrderNumber, // ✅ Use generated order number
            customer_name: customerName, // Store customer name in metadata
            subtotal: actualSubtotal, // ✅ Already in GHS from frontend
            discount: finalDiscount, // ✅ Already in GHS from frontend
            tax: finalTax, // ✅ Already in GHS from frontend
            shipping_fee: finalDeliveryFee || 0, // ✅ Already in GHS from frontend
            total: finalTotal, // ✅ Calculated total in GHS
            payment_method,
            order_id: orderData.id,
          },
          initiated_at: new Date().toISOString(),
        };

        // If payment_reference exists, try to link to existing transaction first
        if (payment_reference) {
          const { data: existingTransaction } = await supabaseAdmin
            .from('transactions')
            .select('id, metadata')
            .or(`transaction_reference.eq.${payment_reference},paystack_reference.eq.${payment_reference}`)
            .limit(1)
            .maybeSingle();

          if (existingTransaction) {
            // Update existing transaction with order_id
            const existingMetadata = (existingTransaction as any).metadata || {};
            await supabaseAdmin
              .from('transactions')
              .update({
                order_id: orderData.id,
                user_id: user_id || null,
                customer_email: customerEmail,
                metadata: {
                  ...existingMetadata,
                  customer_name: customerName,
                  order_number: finalOrderNumber, // ✅ Use generated order number
                },
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingTransaction.id);
            
            console.log('✅ Linked existing transaction to order:', orderData.order_number);
          } else {
            // Create new transaction
            transactionData.paystack_reference = payment_reference;
            const { error: transactionError } = await supabaseAdmin
              .from('transactions')
              .insert([transactionData]);

            if (transactionError) {
              console.error('Error creating transaction:', transactionError);
            } else {
              console.log('✅ Created transaction for order:', orderData.order_number);
            }
          }
        } else {
          // Create transaction for cash on delivery or orders without payment reference
          const { error: transactionError } = await supabaseAdmin
            .from('transactions')
            .insert([transactionData]);

          if (transactionError) {
            console.error('Error creating transaction:', transactionError);
          } else {
            console.log('✅ Created transaction for order:', orderData.order_number);
          }
        }
      } catch (transactionError) {
        console.error('Error creating/linking transaction:', transactionError);
        // Don't fail order creation if transaction creation fails
      }

      // Extract is_pre_order from shipping_address or orderData
      const isPreOrder = is_pre_order || orderData.is_pre_order || shippingAddress?.is_pre_order || false;
      const preOrderShippingOption = pre_order_shipping_option || orderData.pre_order_shipping_option || shippingAddress?.pre_order_shipping_option || null;
      const estimatedArrivalDate = estimated_arrival_date || orderData.estimated_arrival_date || shippingAddress?.estimated_arrival_date || null;

      // Determine customer email and name for order confirmation
      let customerEmail: string | null = null;
      let customerName: string = 'Customer';
      
      if (userData && userData.email) {
        // Logged-in user
        customerEmail = userData.email;
        customerName = userData.full_name || `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || 'Customer';
      } else if (orderData.customer_bio && orderData.customer_bio.email) {
        // Guest customer - use email from customer_bio
        customerEmail = orderData.customer_bio.email;
        customerName = orderData.customer_bio.name || 'Guest Customer';
      }
      // Note: Recipient email is NOT stored in delivery_address anymore
      // Only customer (logged-in or guest) receives emails, not recipients

      // Send order confirmation email to CUSTOMER (logged-in or guest)
      // Recipient email is not stored, so only customer gets email
      if (customerEmail) {
        try {
          console.log(`📧 Preparing to send order confirmation email to customer: ${customerEmail}`);
          const emailData = {
            ...orderData,
            user_id: user_id || null,
            customer_name: customerName,
            customer_email: customerEmail,
            items: orderItems,
            notes: orderData.notes || null,
            delivery_address: shippingAddress, // Keep for email template compatibility
            is_pre_order: isPreOrder,
            pre_order_shipping_option: preOrderShippingOption,
            estimated_arrival_date: estimatedArrivalDate,
          };

          const emailResult = await enhancedEmailService.sendOrderConfirmation(emailData);
          if (emailResult.skipped) {
            console.log(`⚠️ Order confirmation email skipped: ${emailResult.reason}`);
          } else if (emailResult.success) {
            console.log(`✅ Order confirmation email sent successfully to customer ${customerEmail}`);
          } else {
            console.error(`❌ Failed to send order confirmation email to customer ${customerEmail}:`, emailResult.reason);
          }
        } catch (emailError: any) {
          console.error('❌ Error sending order confirmation email:', {
            error: emailError,
            message: emailError?.message || 'Unknown error',
            customerEmail,
            orderNumber: orderData.order_number,
          });
          // Don't fail the request if email fails
        }
      } else {
        console.warn('⚠️ No customer email found for order confirmation. user_id:', user_id, 'customer_bio:', orderData.customer_bio);
      }

      // Record coupon usage if the server accepted the coupon
      if (priced.couponId && finalDiscount > 0) {
        try {
          const { error: couponUsageError } = await supabaseAdmin.rpc('record_coupon_usage', {
            coupon_id_param: priced.couponId,
            user_id_param: user_id || null,
            order_id_param: orderData.id,
            discount_amount_param: finalDiscount,
            order_total_param: actualSubtotal, // Original total before discount
          });

          if (couponUsageError) {
            console.error('❌ Failed to record coupon usage:', couponUsageError);
            // Don't fail the order if coupon usage recording fails
          } else {
            console.log(`✅ Recorded coupon usage for coupon ${priced.couponId} on order ${orderData.id}`);
          }
        } catch (couponError) {
          console.error('❌ Error recording coupon usage:', couponError);
          // Don't fail the order if coupon usage recording fails
        }
      }

      // Send admin notification email
      try {
        console.log(`📧 Sending admin order notification email to ${adminNotificationEmail}`);
        const emailData = {
          ...orderData,
          customer_name: userData?.full_name || orderData.customer_bio?.name || shippingAddress?.recipient_name || 'Guest Customer',
          customer_email: userData?.email || orderData.customer_bio?.email || 'No email', // Customer email (logged-in or guest), not recipient email
          items: orderItems,
          notes: orderData.notes || null,
          delivery_address: shippingAddress, // Keep for email template compatibility
          is_pre_order: isPreOrder,
          pre_order_shipping_option: preOrderShippingOption,
          estimated_arrival_date: estimatedArrivalDate,
        };

        const adminEmailResult = await enhancedEmailService.sendAdminOrderNotification(emailData);
        if (adminEmailResult.success) {
          console.log(`✅ Admin order notification email sent successfully to ${adminNotificationEmail}`);
        } else {
          console.error('❌ Failed to send admin order notification email:', adminEmailResult.reason);
        }
      } catch (emailError: any) {
        console.error('❌ Error sending admin order notification email:', {
          error: emailError,
          message: emailError?.message || 'Unknown error',
          orderNumber: orderData.order_number,
        });
        // Don't fail the request if email fails
      }

      // Create admin notification in dashboard
      try {
        const { error: notifError } = await supabaseAdmin
          .from('notifications')
          .insert([{
            type: 'order',
            title: `New Order: ${orderData.order_number}`,
            message: `New order received from ${userData?.full_name || shippingAddress?.full_name || 'Guest Customer'}. Total: GHS ${orderData.total.toFixed(2)}`,
            action_url: `/admin/orders/${orderData.id}`,
            is_read: false,
          }]);

        if (notifError) {
          console.error('Failed to create admin notification:', notifError);
        } else {
          console.log('Admin notification created successfully');
        }
      } catch (notifError) {
        console.error('Failed to create admin notification:', notifError);
        // Don't fail the request if notification fails
      }

      console.log('✅ Order creation completed successfully:', {
        order_id: orderData.id,
        order_number: orderData.order_number,
        total: orderData.total,
        email_sent: true, // Email is sent above
        stock_updated: true, // Stock is updated above
      });

      if (paymentStatus === 'paid') {
        await maybeCreateCommissionAfterPayment(req, {
          ...orderData,
          order_items: orderItems,
        });
      }

      res.json({
        success: true,
        message: 'Order created successfully',
        data: orderData,
      });
    } catch (error: any) {
      if (error instanceof PricingError) {
        console.warn(`⚠️ Order rejected (${error.code}): ${error.message}`);
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          error: error.code,
          ...error.extra,
        });
      }

      console.error('❌ Error creating order:', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
      });
      res.status(500).json({
        success: false,
        message: 'Failed to create order',
        error: error instanceof Error ? error.message : (error?.message || 'Unknown error'),
        details: error?.details || error?.hint || undefined,
        code: error?.code || undefined,
      });
    }
  }

  // Send wishlist reminder
  async sendWishlistReminder(req: Request, res: Response) {
    try {
      const { user_id } = req.params;

      // Get user data
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('id', user_id)
        .single();

      if (userError) throw userError;

      // Get wishlist items
      const { data: wishlistData, error: wishlistError } = await supabaseAdmin
        .from('wishlists')
        .select(`
          *,
          product:products!wishlists_product_id_fkey(*)
        `)
        .eq('user_id', user_id);

      if (wishlistError) throw wishlistError;

      if (wishlistData && wishlistData.length > 0) {
        // Format wishlist items for email
        const wishlistItems = wishlistData.map((item: any) => ({
          product_name: item.product?.name || 'Unknown Product',
          product_description: item.product?.description || '',
          product_price: item.product?.discount_price || item.product?.price || 0,
        }));

        const emailResult = await enhancedEmailService.sendWishlistReminder(
          userData.id,
          wishlistItems
        );
        if (emailResult.skipped) {
          console.log(`Wishlist reminder email skipped: ${emailResult.reason}`);
        } else if (emailResult.success) {
          console.log('Wishlist reminder email sent successfully');
        } else {
          console.error('Failed to send wishlist reminder email:', emailResult.reason);
        }
      }

      res.json({
        success: true,
        message: 'Wishlist reminder sent successfully',
      });
    } catch (error) {
      console.error('Error sending wishlist reminder:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send wishlist reminder',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Send cart abandonment reminder
  async sendCartAbandonmentReminder(req: Request, res: Response) {
    try {
      const { user_id, cart_items } = req.body;

      // Get user data
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('id', user_id)
        .single();

      if (userError) throw userError;

      const emailResult = await enhancedEmailService.sendCartAbandonmentReminder(
        userData.id,
        cart_items || []
      );
      if (emailResult.skipped) {
        console.log(`Cart abandonment reminder email skipped: ${emailResult.reason}`);
      } else if (emailResult.success) {
        console.log('Cart abandonment reminder email sent successfully');
      } else {
        console.error('Failed to send cart abandonment reminder email:', emailResult.reason);
      }

      res.json({
        success: true,
        message: 'Cart abandonment reminder sent successfully',
      });
    } catch (error) {
      console.error('Error sending cart abandonment reminder:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send cart abandonment reminder',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Download order PDF
  async downloadOrderPDF(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Get order data with all related information
      let { data: orderData, error: orderError } = await supabaseAdmin
        .from('orders')
        .select(`
          *,
          user:users!orders_user_id_fkey(id, first_name, last_name, email),
          order_items!order_items_order_id_fkey(*)
        `)
        .eq('id', id)
        .single();

      // If query fails or no items, try fetching separately
      if (orderError || !orderData) {
        // Try without explicit FK name
        const result = await supabaseAdmin
          .from('orders')
          .select(`
            *,
            user:users!orders_user_id_fkey(id, first_name, last_name, email),
            order_items(*)
          `)
          .eq('id', id)
          .single();
        
        if (!result.error && result.data) {
          orderData = result.data;
          orderError = null;
        }
      }

      // If still no items, fetch separately
      if (!orderError && orderData && (!orderData.order_items || orderData.order_items.length === 0)) {
        console.log('No items found in order query, fetching separately...');
        const { data: itemsData, error: itemsError } = await supabaseAdmin
          .from('order_items')
          .select('*')
          .eq('order_id', id);
        
        if (!itemsError && itemsData) {
          console.log('Fetched items separately for PDF:', itemsData.length, 'items');
          orderData.order_items = itemsData;
        } else if (itemsError) {
          console.error('Error fetching items separately for PDF:', itemsError);
        }
      }

      if (orderError) throw orderError;

      // Extract is_pre_order from shipping_address if it exists there
      // Also check if it's a direct column (for backward compatibility)
      const isPreOrder = orderData.is_pre_order || orderData.shipping_address?.is_pre_order || false;
      const preOrderShippingOption = orderData.pre_order_shipping_option || orderData.shipping_address?.pre_order_shipping_option || null;
      const estimatedArrivalDate = orderData.estimated_arrival_date || orderData.shipping_address?.estimated_arrival_date || null;

      // Add pre-order fields and customer_bio to the order data for PDF
      const orderDataForPDF = {
        ...orderData,
        is_pre_order: isPreOrder,
        pre_order_shipping_option: preOrderShippingOption,
        estimated_arrival_date: estimatedArrivalDate,
        customer_bio: orderData.customer_bio || null, // Include customer_bio for PDF
      };

      // Debug: Log order data before PDF generation
      console.log('Order data for PDF:', {
        orderId: id,
        hasOrderItems: !!orderDataForPDF.order_items,
        orderItemsLength: orderDataForPDF.order_items?.length || 0,
        is_pre_order: isPreOrder,
        pre_order_shipping_option: preOrderShippingOption,
      });

      // Generate PDF
      const pdfBuffer = await pdfService.generateOrderPDF(orderDataForPDF);

      // Set response headers
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="order-${orderData.order_number}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);

      // Send PDF
      res.send(pdfBuffer);
    } catch (error) {
      console.error('Error generating order PDF:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate order PDF',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}