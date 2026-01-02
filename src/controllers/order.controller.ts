import { Request, Response } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import enhancedEmailService from '../services/enhanced-email.service';
import pdfService from '../services/pdf.service';

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
    try {
      const { order_number_or_id, email } = req.body;

      if (!order_number_or_id || !email) {
        return res.status(400).json({
          success: false,
          message: 'Order number/ID and email are required',
        });
      }

      // ✅ Safer pattern: Avoid mutating destructured variables
      // Try to find order by order_number first, then by id
      // IMPORTANT: Do NOT filter by status - include ALL orders including cancelled ones
      let order = null;
      let fetchError = null;

      const byNumberResult = await supabaseAdmin
        .from('orders')
        .select(`
          *,
          user:users!orders_user_id_fkey(id, email),
          order_items:order_items(*)
        `)
        .eq('order_number', order_number_or_id)
        .maybeSingle();

      if (byNumberResult.data) {
        order = byNumberResult.data;
      } else if (byNumberResult.error) {
        fetchError = byNumberResult.error;
      }

      // If not found by order_number, try by id
      if (!order && !fetchError) {
        const byIdResult = await supabaseAdmin
          .from('orders')
          .select(`
            *,
            user:users!orders_user_id_fkey(id, email),
            order_items:order_items(*)
          `)
          .eq('id', order_number_or_id)
          .maybeSingle();
        
        if (byIdResult.data) {
          order = byIdResult.data;
        } else if (byIdResult.error) {
          fetchError = byIdResult.error;
        }
      }

      if (fetchError) {
        console.error('Error fetching order for tracking:', {
          code: fetchError.code,
          message: fetchError.message,
          details: fetchError.details,
          hint: fetchError.hint,
        });
        return res.status(500).json({
          success: false,
          message: 'Failed to fetch order',
          error: fetchError.message,
        });
      }

      if (!order) {
        // ✅ Security: Always return same response time to prevent timing attacks
        // Use setTimeout to normalize response time (add small random delay)
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 50));
        return res.status(404).json({
          success: false,
          message: 'Order not found',
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
          message: 'Order not found',
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
      console.error('Error tracking order:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to track order',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Get order by ID
  async getOrderById(req: Request, res: Response) {
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
      const { data: orderData, error: orderError } = await supabaseAdmin
        .from('orders')
        .update({
          status,
          tracking_number,
          notes,
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
  async cancelOrder(req: Request, res: Response) {
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

      // Verify ownership for anonymous users
      if (!existingOrder.user_id && email) {
        // Anonymous order - verify email matches
        const orderEmail = existingOrder.shipping_address?.email;
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
  async createOrder(req: Request, res: Response) {
    try {
      console.log('📦 Order creation request received:', {
        hasUserId: !!req.body.user_id,
        hasOrderItems: !!req.body.order_items,
        orderItemsCount: req.body.order_items?.length || 0,
        hasDeliveryAddress: !!req.body.delivery_address,
        paymentMethod: req.body.payment_method,
        paymentReference: req.body.payment_reference,
        total: req.body.total,
      });

      const {
        user_id,
        order_number, // Optional - will be generated if not provided
        subtotal,
        discount,
        tax,
        delivery_fee,
        delivery_option,
        total,
        payment_method,
        delivery_address,
        customer_bio, // Customer bio information (name, email, phone)
        order_items,
        notes,
        payment_reference,
        // Pre-order fields
        is_pre_order,
        pre_order_shipping_option,
        estimated_arrival_date,
      } = req.body;

      // ✅ CRITICAL: Frontend sends all amounts in GHS
      // DO NOT apply heuristic normalization - values are already in GHS
      // Only Paystack responses need conversion (handled in payment.controller.ts)
      
      // Use values as-is (already in GHS from frontend)
      const finalSubtotal = subtotal || 0;
      const finalDeliveryFee = delivery_fee || 0;
      const finalTax = tax || 0;
      const finalDiscount = discount || 0;

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

      // Validate total (already in GHS from frontend)
      if (!total || total <= 0) {
        console.error('❌ Order creation failed: Invalid total amount', {
          total,
        });
        return res.status(400).json({
          success: false,
          message: 'Invalid total amount',
          error: 'Total must be greater than 0',
        });
      }

      // Validate that all products exist BEFORE creating the order
      // This prevents orphaned orders if products don't exist
      const productIds = order_items.map((item: any) => item.product_id);
      console.log('🔍 STEP 1: Validating products before creating order');
      console.log('🔍 Product IDs to validate:', productIds);
      console.log('🔍 Order items structure:', order_items.map((item: any) => ({ 
        product_id: item.product_id, 
        product_name: item.product_name 
      })));
      
      if (!productIds || productIds.length === 0) {
        console.error('❌ No product IDs found in order items');
        return res.status(400).json({
          success: false,
          message: 'No product IDs found in order items',
          error: 'INVALID_ORDER_ITEMS',
        });
      }

      // Filter out any null/undefined product IDs
      const validProductIds = productIds.filter((id: string) => id && id.trim() !== '');
      if (validProductIds.length !== productIds.length) {
        console.error('❌ Some order items have invalid product IDs');
        return res.status(400).json({
          success: false,
          message: 'Some order items have invalid product IDs',
          error: 'INVALID_PRODUCT_IDS',
        });
      }

      const { data: existingProducts, error: productsCheckError } = await supabaseAdmin
        .from('products')
        .select('id, name, in_stock')
        .in('id', validProductIds);

      console.log('🔍 Products found in database:', existingProducts?.length || 0, 'out of', validProductIds.length);

      if (productsCheckError) {
        console.error('❌ Error checking products:', productsCheckError);
        return res.status(400).json({
          success: false,
          message: 'Failed to validate products',
          error: productsCheckError.message,
        });
      }

      const existingProductIds = new Set((existingProducts || []).map((p: any) => p.id));
      const missingProductIds = validProductIds.filter((id: string) => !existingProductIds.has(id));

      if (missingProductIds.length > 0) {
        console.error('❌ STEP 1 FAILED: Some products do not exist:', missingProductIds);
        console.error('❌ Existing product IDs:', Array.from(existingProductIds));
        return res.status(400).json({
          success: false,
          message: `Products not found: ${missingProductIds.join(', ')}. These products may have been removed from the catalog.`,
          error: 'PRODUCTS_NOT_FOUND',
          missingProductIds,
        });
      }

      console.log('✅ STEP 1 PASSED: All products validated successfully');

      // Generate order number if not provided (backend generates sequential number)
      const finalOrderNumber = order_number || await this.generateOrderNumber();
      console.log('✅ Generated order number:', finalOrderNumber);

      // Map delivery_address to shipping_address and include delivery_option in the address JSON
      const shippingAddress = delivery_address ? {
        ...delivery_address,
        delivery_option: delivery_option || { name: 'Standard', price: delivery_fee || 0 },
        // Include pre-order information in shipping address
        ...(is_pre_order ? {
          is_pre_order: true,
          pre_order_shipping_option: pre_order_shipping_option || null,
          estimated_arrival_date: estimated_arrival_date || null,
        } : {}),
      } : null;

      // ✅ Calculate total from values (all already in GHS from frontend)
      // Recalculate subtotal from order items if missing
      let actualSubtotal = finalSubtotal;
      
      if (!finalSubtotal || finalSubtotal === 0) {
        console.warn('⚠️ Subtotal missing or zero, recalculating from order items');
        actualSubtotal = order_items.reduce((sum: number, item: any) => {
          // Use item subtotal if available, otherwise calculate from unit_price * quantity
          const itemSubtotal = item.subtotal || (item.unit_price * (item.quantity || 1));
          return sum + itemSubtotal;
        }, 0);
      }
      
      // ✅ CRITICAL: Calculate total from components ONLY - NEVER use req.body.total directly
      // req.body.total might be in pesewas (from Paystack) or incorrect
      // ALWAYS calculate from: subtotal + delivery_fee + tax - discount
      const calculatedTotal = actualSubtotal + finalDeliveryFee + finalTax - finalDiscount;
      
      // ✅ NEVER use req.body.total - always use calculated value
      const finalTotal = calculatedTotal;
      
      // ✅ Safety check: Warn if req.body.total differs significantly from calculated total
      // This catches cases where Paystack amount (pesewas) was sent as total
      if (total && Math.abs(total - finalTotal) > 0.01) {
        const difference = Math.abs(total - finalTotal);
        const ratio = total > finalTotal ? total / finalTotal : finalTotal / total;
        
        // If difference is significant (more than 1% or > 100x), log warning
        if (difference > finalTotal * 0.01 || ratio > 10) {
          console.warn('⚠️ WARNING: req.body.total differs from calculated total:', {
            reqBodyTotal: total,
            calculatedTotal: finalTotal,
            difference,
            ratio,
            possibleCause: ratio > 10 ? 'Paystack amount (pesewas) may have been sent as total' : 'Frontend calculation mismatch',
          });
        }
      }
      
      console.log('💰 Order calculation (all values in GHS):', {
        subtotal: actualSubtotal,
        delivery_fee: finalDeliveryFee,
        tax: finalTax,
        discount: finalDiscount,
        calculatedTotal: finalTotal,
        reqBodyTotal: total, // Logged for comparison only, NOT used
      });
      
      // ✅ Safety check: Ensure total is reasonable
      if (finalTotal < 0) {
        console.error('🚨 Negative order total detected:', {
          finalTotal,
          actualSubtotal,
          finalDeliveryFee,
          finalTax,
          finalDiscount,
        });
        return res.status(400).json({
          success: false,
          message: 'Invalid order total: negative amount detected.',
          error: 'NEGATIVE_ORDER_TOTAL',
        });
      }
      
      // ✅ CRITICAL: Hard guard against pesewas being sent as GHS
      // If total > 100,000 GHS, it's almost certainly pesewas (100x conversion error)
      // Legitimate orders in Ghana rarely exceed 100,000 GHS
      if (finalTotal > 100000) {
        console.error('🚨 CRITICAL: Order total exceeds 100,000 GHS - likely pesewas conversion error:', {
          finalTotal,
          reqBodyTotal: total,
          actualSubtotal,
          finalDeliveryFee,
          finalTax,
          finalDiscount,
          possibleCause: 'Paystack metadata prices (pesewas) may have been used as GHS',
        });
        return res.status(400).json({
          success: false,
          message: `Invalid order total detected (${finalTotal.toFixed(2)} GHS). Prices must be in GHS, not pesewas. Please contact support.`,
          error: 'INVALID_TOTAL_PESEWAS_DETECTED',
          details: 'Order total exceeds reasonable limit. This may indicate prices were sent in pesewas instead of GHS.',
        });
      }

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
        shipping_address: shippingAddress ? {
          ...shippingAddress,
          // Only include payment_reference if provided (store in shipping_address JSON)
          ...(payment_reference ? { payment_reference } : {}),
        } : null,
        customer_bio: customer_bio || null, // Store customer bio information
        notes: is_pre_order 
          ? `${notes || ''}\n\n[PRE-ORDER] Shipping: ${pre_order_shipping_option || 'Not specified'}. Estimated Arrival: ${estimated_arrival_date ? new Date(estimated_arrival_date).toLocaleDateString() : 'TBD'}`.trim()
          : (notes || null),
        status: 'pending',
        // ✅ Consistent payment_status logic
        // Set payment_status based on payment method
        // If payment_method is paystack and payment_reference exists, payment was successful
        payment_status: (payment_method === 'paystack' && payment_reference) ? 'paid' : 'pending',
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

      // Create order items and decrease stock
      // ✅ All item prices are already in GHS from frontend
      const orderItems = order_items.map((item: any) => {
        // Use item prices as-is (already in GHS)
        const itemUnitPrice = item.unit_price || 0;
        const itemSubtotal = item.subtotal || item.total_price || (itemUnitPrice * (item.quantity || 1));
        
        return {
          order_id: orderData.id,
          product_id: item.product_id,
          product_name: item.product_name,
          product_image: item.product_image,
          quantity: item.quantity,
          unit_price: itemUnitPrice, // ✅ Already in GHS
          total_price: itemSubtotal, // ✅ Already in GHS
          selected_variants: item.selected_variants,
        };
      });

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
      if (!is_pre_order) {
        try {
          for (const item of order_items) {
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
                    } else {
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
                              to: 'ventechgadgets@gmail.com',
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
                    // Note: Order is already created, so we log but don't fail
                    // In production, you might want to mark order as "stock_issue" or similar
                  }
                } else {
                  console.error(`❌ Error fetching product ${item.product_id} for stock update:`, productError);
                }
              } else {
                console.error(`❌ Failed to update stock for product ${item.product_id}:`, updateError);
              }
            } else {
              console.log(`✅ Decreased stock for product ${item.product_id} using RPC`);
            }
          }
        } catch (stockError) {
          console.error('❌ Error updating product stock:', stockError);
          // Don't fail order creation if stock update fails - log and continue
        }
      } else {
        console.log('⏭️ Skipping stock update for pre-order');
      }
      // This allows the order to be created even if stock update fails

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
        // ✅ Consistent payment_status logic (same as order)
        const paymentStatus = (payment_method === 'paystack' && payment_reference) ? 'paid' : 'pending';
        
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
            .eq('transaction_reference', payment_reference)
            .or(`paystack_reference.eq.${payment_reference}`)
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

      // Record coupon usage if coupon was applied
      // ✅ All values already in GHS from frontend
      if (req.body.coupon_id && finalDiscount > 0) {
        try {
          const { error: couponUsageError } = await supabaseAdmin.rpc('record_coupon_usage', {
            coupon_id_param: req.body.coupon_id,
            user_id_param: user_id || null,
            order_id_param: orderData.id,
            discount_amount_param: finalDiscount, // ✅ Already in GHS from frontend
            order_total_param: actualSubtotal, // ✅ Already in GHS from frontend - original total before discount
          });

          if (couponUsageError) {
            console.error('❌ Failed to record coupon usage:', couponUsageError);
            // Don't fail the order if coupon usage recording fails
          } else {
            console.log(`✅ Recorded coupon usage for coupon ${req.body.coupon_id} on order ${orderData.id}`);
          }
        } catch (couponError) {
          console.error('❌ Error recording coupon usage:', couponError);
          // Don't fail the order if coupon usage recording fails
        }
      }

      // Send admin notification email
      try {
        console.log('📧 Sending admin order notification email to ventechgadgets@gmail.com');
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
          console.log('✅ Admin order notification email sent successfully to ventechgadgets@gmail.com');
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
            data: {
              order_id: orderData.id,
              order_number: orderData.order_number,
              customer_name: userData?.full_name || shippingAddress?.full_name || 'Guest',
            },
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

      res.json({
        success: true,
        message: 'Order created successfully',
        data: orderData,
      });
    } catch (error: any) {
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