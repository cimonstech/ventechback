import { Request, Response } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import enhancedEmailService from '../services/enhanced-email.service';
import pdfService from '../services/pdf.service';

export class OrderController {
  // Get all orders (admin)
  async getAllOrders(req: Request, res: Response) {
    try {
      const { data, error } = await supabaseAdmin
        .from('orders')
        .select(`
          *,
          user:users!orders_user_id_fkey(id, first_name, last_name, email),
          order_items:order_items(*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.json({
        success: true,
        data: data || [],
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

      res.json({
        success: true,
        data,
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

      // Send email notification
      try {
        const customerName = `${orderData.user.first_name || ''} ${orderData.user.last_name || ''}`.trim() || 'Customer';
        const emailData = {
          ...orderData,
          customer_name: customerName,
          customer_email: orderData.user.email,
        };

        const emailResult = await enhancedEmailService.sendOrderStatusUpdate(emailData, status);
        if (emailResult.skipped) {
          console.log(`Order status update email skipped: ${emailResult.reason}`);
        } else if (emailResult.success) {
          console.log('Order status update email sent successfully');
        } else {
          console.error('Failed to send order status update email:', emailResult.reason);
        }
      } catch (emailError) {
        console.error('Failed to send order status update email:', emailError);
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

  // Cancel order
  async cancelOrder(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { cancellation_reason } = req.body;

      // Update order
      const { data: orderData, error: orderError } = await supabaseAdmin
        .from('orders')
        .update({
          status: 'cancelled',
          notes: cancellation_reason,
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

      // Send cancellation email
      try {
        const customerName = `${orderData.user.first_name || ''} ${orderData.user.last_name || ''}`.trim() || 'Customer';
        const emailData = {
          ...orderData,
          customer_name: customerName,
          customer_email: orderData.user.email,
          cancellation_reason,
        };

        // Note: Using order confirmation template for cancellation
        const emailResult = await enhancedEmailService.sendOrderConfirmation(emailData);
        if (emailResult.skipped) {
          console.log(`Order cancellation email skipped: ${emailResult.reason}`);
        } else if (emailResult.success) {
          console.log('Order cancellation email sent successfully');
        } else {
          console.error('Failed to send order cancellation email:', emailResult.reason);
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

  // Create order (with email confirmation)
  async createOrder(req: Request, res: Response) {
    try {
      const {
        user_id,
        order_number,
        subtotal,
        discount,
        tax,
        delivery_fee,
        total,
        payment_method,
        delivery_address,
        order_items,
      } = req.body;

      // Create order
      const { data: orderData, error: orderError } = await supabaseAdmin
        .from('orders')
        .insert([{
          user_id,
          order_number,
          subtotal,
          discount,
          tax,
          delivery_fee,
          total,
          payment_method,
          delivery_address,
          delivery_option: delivery_option || { name: 'Standard', price: delivery_fee || 0 },
          status: 'pending',
          payment_status: 'pending',
        }])
        .select()
        .single();

      if (orderError) throw orderError;

      // Create order items
      const orderItems = order_items.map((item: any) => ({
        order_id: orderData.id,
        product_id: item.product_id,
        product_name: item.product_name,
        product_image: item.product_image,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
        selected_variants: item.selected_variants,
      }));

      const { error: itemsError } = await supabaseAdmin
        .from('order_items')
        .insert(orderItems);

      if (itemsError) throw itemsError;

      // Get user data for email (if logged in)
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

      // Send order confirmation email to customer (if logged in)
      if (userData && userData.email) {
        try {
          const customerName = userData.full_name || `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || 'Customer';
          const emailData = {
            ...orderData,
            customer_name: customerName,
            customer_email: userData.email,
            items: orderItems,
          };

          const emailResult = await enhancedEmailService.sendOrderConfirmation(emailData);
          if (emailResult.skipped) {
            console.log(`Order confirmation email skipped: ${emailResult.reason}`);
          } else if (emailResult.success) {
            console.log('Order confirmation email sent successfully');
          } else {
            console.error('Failed to send order confirmation email:', emailResult.reason);
          }
        } catch (emailError) {
          console.error('Failed to send order confirmation email:', emailError);
          // Don't fail the request if email fails
        }
      } else if (!user_id) {
        // For guest orders, get email from delivery_address if provided
        const guestEmail = (delivery_address as any)?.email;
        if (guestEmail) {
          try {
            const customerName = delivery_address?.full_name || 'Guest Customer';
            const emailData = {
              ...orderData,
              customer_name: customerName,
              customer_email: guestEmail,
              items: orderItems,
            };

            const emailResult = await enhancedEmailService.sendOrderConfirmation(emailData);
            if (emailResult.success) {
              console.log('Guest order confirmation email sent successfully');
            }
          } catch (emailError) {
            console.error('Failed to send guest order confirmation email:', emailError);
          }
        }
      }

      // Send admin notification email
      try {
        const adminEmail = 'ventechgadget@gmail.com';
        const emailData = {
          ...orderData,
          customer_name: userData?.full_name || delivery_address?.full_name || 'Guest Customer',
          customer_email: userData?.email || (delivery_address as any)?.email || 'No email',
          items: orderItems,
        };

        await enhancedEmailService.sendAdminOrderNotification(emailData);
        console.log('Admin order notification email sent successfully');
      } catch (emailError) {
        console.error('Failed to send admin order notification email:', emailError);
        // Don't fail the request if email fails
      }

      // Create admin notification in dashboard
      try {
        const { error: notifError } = await supabaseAdmin
          .from('notifications')
          .insert([{
            type: 'order',
            title: `New Order: ${orderData.order_number}`,
            message: `New order received from ${userData?.full_name || delivery_address?.full_name || 'Guest Customer'}. Total: GHS ${orderData.total.toFixed(2)}`,
            data: {
              order_id: orderData.id,
              order_number: orderData.order_number,
              customer_name: userData?.full_name || delivery_address?.full_name || 'Guest',
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

      res.json({
        success: true,
        message: 'Order created successfully',
        data: orderData,
      });
    } catch (error) {
      console.error('Error creating order:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create order',
        error: error instanceof Error ? error.message : 'Unknown error',
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
      const { data: orderData, error: orderError } = await supabaseAdmin
        .from('orders')
        .select(`
          *,
          user:users!orders_user_id_fkey(id, first_name, last_name, email),
          order_items:order_items(*)
        `)
        .eq('id', id)
        .single();

      if (orderError) throw orderError;

      // Generate PDF
      const pdfBuffer = await pdfService.generateOrderPDF(orderData);

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