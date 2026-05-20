import { Request, Response } from 'express';
import axios from 'axios';
import { supabaseAdmin } from '../utils/supabaseClient';

export class PaymentController {
  // Initialize Paystack transaction (from backend as per Paystack best practices)
  async initializeTransaction(req: Request, res: Response) {
    try {
      const { email, amount, reference, callback_url, metadata } = req.body;

      // Validate required fields
      if (!email || !amount || !reference) {
        return res.status(400).json({
          success: false,
          message: 'Email, amount, and reference are required',
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

      const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
      if (!paystackSecretKey) {
        return res.status(500).json({
          success: false,
          message: 'Paystack secret key not configured',
        });
      }

      // Prepare Paystack initialize transaction payload
      const payload: any = {
        email,
        amount: Math.round(amount), // Amount in pesewas (GHS * 100)
        reference,
        currency: 'GHS',
      };

      // Add callback URL if provided
      if (callback_url) {
        payload.callback_url = callback_url;
      }

      // Add metadata if provided
      if (metadata) {
        payload.metadata = metadata;
      }

      // Initialize transaction with Paystack
      const response = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        payload,
        {
          headers: {
            Authorization: `Bearer ${paystackSecretKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data.status) {
        return res.json({
          success: true,
          data: response.data.data,
          message: 'Transaction initialized successfully',
        });
      } else {
        return res.status(400).json({
          success: false,
          message: response.data.message || 'Failed to initialize transaction',
        });
      }
    } catch (error: any) {
      console.error('Error initializing Paystack transaction:', error);
      return res.status(500).json({
        success: false,
        message: error.response?.data?.message || 'Failed to initialize transaction',
        error: error.message,
      });
    }
  }

  // Verify Paystack transaction
  async verifyTransaction(req: Request, res: Response) {
    try {
      const { reference } = req.body;

      if (!reference) {
        return res.status(400).json({
          success: false,
          message: 'Transaction reference is required',
        });
      }

      const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
      if (!paystackSecretKey) {
        return res.status(500).json({
          success: false,
          message: 'Paystack secret key not configured',
        });
      }

      // Verify transaction with Paystack
      const response = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${paystackSecretKey}`,
          },
        }
      );

      if (response.data.status) {
        const transaction = response.data.data;

        // Verify transaction status and amount
        const isSuccessful = transaction.status === 'success';
        const verifiedAmount = transaction.amount;

        // Save transaction to database for tracking
        try {
          const transactionData: any = {
            transaction_reference: reference,
            paystack_reference: transaction.reference,
            payment_method: transaction.metadata?.payment_method || 'paystack',
            payment_provider: 'paystack',
            amount: verifiedAmount / 100, // Convert from pesewas to GHS
            currency: transaction.currency || 'GHS',
            status: isSuccessful ? 'success' : 'failed',
            payment_status: isSuccessful ? 'paid' : 'failed',
            customer_email: transaction.customer?.email || transaction.metadata?.customer_email || '',
            customer_code: transaction.customer?.customer_code || null,
            authorization_code: transaction.authorization?.authorization_code || null,
            channel: transaction.channel || null,
            metadata: transaction.metadata || {},
            initiated_at: transaction.created_at ? new Date(transaction.created_at).toISOString() : new Date().toISOString(),
          };

          // Add paid_at timestamp if successful
          if (isSuccessful && transaction.paid_at) {
            transactionData.paid_at = new Date(transaction.paid_at).toISOString();
          }

          // Add user_id if available in metadata
          if (transaction.metadata?.user_id && transaction.metadata.user_id !== 'guest') {
            transactionData.user_id = transaction.metadata.user_id;
          }

          // Try to find associated order by payment reference or order_id in metadata
          let foundOrderId: string | null = null;
          
          if (transaction.metadata?.order_id) {
            // Direct order_id from metadata
            const { data: orderData } = await supabaseAdmin
              .from('orders')
              .select('id, user_id, order_number')
              .eq('id', transaction.metadata.order_id)
              .maybeSingle();
            
            if (orderData) {
              foundOrderId = orderData.id;
              transactionData.order_id = orderData.id;
              if (!transactionData.user_id && orderData.user_id) {
                transactionData.user_id = orderData.user_id;
              }
            }
          } else if (transaction.metadata?.payment_reference) {
            // Try to find order by payment_reference stored in shipping_address JSON
            // payment_reference is stored in shipping_address JSON, not as a direct column
            const paymentRef = transaction.metadata.payment_reference;
            
            // First, try to find by checking shipping_address JSON
            const { data: ordersByRef } = await supabaseAdmin
              .from('orders')
              .select('id, user_id, order_number, shipping_address')
              .or(`order_number.eq.${paymentRef}`)
              .limit(10); // Limit to avoid too many results
            
            // Check if any order has payment_reference in shipping_address
            if (ordersByRef && ordersByRef.length > 0) {
              for (const order of ordersByRef) {
                const shippingAddr = order.shipping_address as any;
                if (shippingAddr?.payment_reference === paymentRef || order.order_number === paymentRef) {
                  foundOrderId = order.id;
                  transactionData.order_id = order.id;
                  if (!transactionData.user_id && order.user_id) {
                    transactionData.user_id = order.user_id;
                  }
                  break;
                }
              }
            }
          }

          // Insert or update transaction
          const { error: dbError } = await supabaseAdmin
            .from('transactions')
            .upsert(transactionData, {
              onConflict: 'transaction_reference',
              ignoreDuplicates: false,
            });

          if (dbError) {
            console.error('Error saving transaction to database:', dbError);
            // Don't fail the request if DB save fails
          }

          // Update order payment_status if payment was successful and we have an order_id
          const orderIdToUpdate = transactionData.order_id || foundOrderId;
          if (isSuccessful && orderIdToUpdate) {
            try {
              // Determine payment method from Paystack channel
              let paymentMethod = 'paystack';
              if (transaction.channel) {
                // Map Paystack channels to payment methods
                const channelMap: Record<string, string> = {
                  'card': 'paystack',
                  'bank': 'paystack',
                  'ussd': 'paystack',
                  'qr': 'paystack',
                  'mobile_money': 'paystack',
                  'mpesa': 'paystack',
                  'mtn': 'paystack',
                  'vodafone': 'paystack',
                  'tigo': 'paystack',
                };
                paymentMethod = channelMap[transaction.channel.toLowerCase()] || 'paystack';
              }

              const { error: updateOrderError } = await supabaseAdmin
                .from('orders')
                .update({
                  payment_status: 'paid',
                  payment_method: paymentMethod,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', orderIdToUpdate);

              if (updateOrderError) {
                console.error('Error updating order payment status:', updateOrderError);
              } else {
                console.log(`✅ Updated order ${orderIdToUpdate} payment_status to 'paid' with method '${paymentMethod}'`);
              }
            } catch (updateError) {
              console.error('Error updating order payment status:', updateError);
            }
          }
        } catch (dbError) {
          console.error('Error saving transaction:', dbError);
          // Don't fail the request if DB save fails
        }

        // Return response with metadata for frontend to use
        return res.json({
          success: isSuccessful,
          data: {
            reference: transaction.reference,
            status: transaction.status, // 'success' if payment successful
            amount: verifiedAmount, // ⚠️ Amount in pesewas - DO NOT use directly for order totals
            amount_ghs: verifiedAmount / 100, // ✅ Converted to GHS for reference only
            currency: transaction.currency,
            customer: transaction.customer,
            metadata: transaction.metadata || {}, // Include metadata (checkout_data, user_id, etc.)
            paid_at: transaction.paid_at,
            created_at: transaction.created_at,
          },
          message: isSuccessful ? 'Transaction verified successfully' : 'Transaction verification failed',
        });
      } else {
        return res.status(400).json({
          success: false,
          message: response.data.message || 'Transaction verification failed',
        });
      }
    } catch (error: any) {
      console.error('Error verifying Paystack transaction:', error);
      return res.status(500).json({
        success: false,
        message: error.response?.data?.message || 'Failed to verify transaction',
        error: error.message,
      });
    }
  }

  // Handle Paystack webhook (for automatic order creation after payment)
  async handleWebhook(req: Request, res: Response) {
    try {
      const crypto = require('crypto');
      const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
      
      if (!paystackSecretKey) {
        console.error('Paystack secret key not configured');
        return res.status(500).json({
          success: false,
          message: 'Paystack secret key not configured',
        });
      }

      // Verify webhook signature (Paystack sends X-Paystack-Signature header)
      const signature = req.headers['x-paystack-signature'] as string;
      if (!signature) {
        console.error('Missing Paystack signature in webhook');
        return res.status(400).json({
          success: false,
          message: 'Missing signature',
        });
      }

      // Verify signature
      const hash = crypto
        .createHmac('sha512', paystackSecretKey)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (hash !== signature) {
        console.error('Invalid Paystack webhook signature');
        return res.status(400).json({
          success: false,
          message: 'Invalid signature',
        });
      }

      const event = req.body;
      console.log('🔔 Paystack webhook received:', {
        event: event.event,
        reference: event.data?.reference,
        status: event.data?.status,
      });

      // Handle payment.success event
      if (event.event === 'charge.success' || event.event === 'transaction.success') {
        const transaction = event.data;
        
        if (transaction.status === 'success') {
          console.log('✅ Payment successful, creating order from webhook...');
          
          // Get checkout data from metadata
          const metadata = transaction.metadata || {};
          const checkoutData = metadata.checkout_data;
          
          if (!checkoutData) {
            console.error('❌ No checkout data in webhook metadata');
            return res.status(400).json({
              success: false,
              message: 'No checkout data found in metadata',
            });
          }

          // Import OrderController
          const { OrderController } = await import('./order.controller');
          const orderController = new OrderController();

          // Create order using checkout data from metadata
          try {
            const userId = metadata.user_id && metadata.user_id !== 'guest' 
              ? metadata.user_id 
              : null;

            // Calculate totals if not provided
            const items = checkoutData.items || [];
            const subtotal = checkoutData.subtotal || items.reduce((sum: number, item: any) => sum + (item.subtotal || (item.quantity * (item.discount_price || item.price || item.original_price || 0))), 0);
            const deliveryFee = checkoutData.delivery_option?.price || checkoutData.delivery_fee || 0;
            const tax = checkoutData.tax || 0;
            const total = checkoutData.total || (subtotal + deliveryFee + tax);

            // Prepare order items
            const orderItems = items.map((item: any) => ({
              product_id: item.id,
              product_name: item.name,
              product_image: item.thumbnail || item.image_url || '',
              quantity: item.quantity,
              unit_price: item.discount_price || item.price || item.original_price || 0,
              subtotal: item.subtotal || (item.quantity * (item.discount_price || item.price || item.original_price || 0)),
              selected_variants: item.selected_variants || {},
            }));

            console.log('📦 Creating order from webhook:', {
              userId,
              itemsCount: orderItems.length,
              subtotal,
              deliveryFee,
              tax,
              total,
              hasDeliveryAddress: !!checkoutData.delivery_address,
            });

            // Prepare order creation request
            const orderRequest = {
              body: {
                user_id: userId,
                subtotal,
                discount: checkoutData.discount || 0,
                tax,
                delivery_fee: deliveryFee,
                delivery_option: checkoutData.delivery_option,
                total,
                payment_method: checkoutData.payment_method || 'paystack',
                delivery_address: checkoutData.delivery_address,
                order_items: orderItems,
                notes: checkoutData.notes || null,
                payment_reference: transaction.reference,
              },
            } as any;

            // Create order
            await orderController.createOrder(orderRequest, res);
            
            console.log('✅ Order created successfully from webhook');
            return; // Response already sent by createOrder
          } catch (orderError: any) {
            console.error('❌ Error creating order from webhook:', orderError);
            return res.status(500).json({
              success: false,
              message: 'Failed to create order from webhook',
              error: orderError.message,
            });
          }
        }
      }

      // Return success for other events (to acknowledge receipt)
      return res.json({
        success: true,
        message: 'Webhook received',
      });
    } catch (error: any) {
      console.error('Error handling Paystack webhook:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to process webhook',
        error: error.message,
      });
    }
  }

  // Update transaction with order_id after order is created
  async updateOrderLink(req: Request, res: Response) {
    try {
      const { transaction_reference, order_id } = req.body;

      if (!transaction_reference || !order_id) {
        return res.status(400).json({
          success: false,
          message: 'Transaction reference and order ID are required',
        });
      }

      // Update transaction with order_id
      const { error: updateError } = await supabaseAdmin
        .from('transactions')
        .update({
          order_id,
          updated_at: new Date().toISOString(),
        })
        .eq('transaction_reference', transaction_reference);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update transaction-order link',
          error: updateError.message,
        });
      }

      return res.json({
        success: true,
        message: 'Transaction linked to order successfully',
      });
    } catch (error: any) {
      console.error('Error updating transaction-order link:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update transaction-order link',
        error: error.message,
      });
    }
  }
}

