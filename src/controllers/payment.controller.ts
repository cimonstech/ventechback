import crypto from 'crypto';
import { Request, Response } from 'express';
import axios from 'axios';
import { supabaseAdmin } from '../utils/supabaseClient';
import { AuthRequest } from '../middleware/auth.middleware';
import { PricingError, priceOrder } from '../services/pricing.service';
import { AffiliateError, applyAffiliateFeePaid } from '../services/affiliate.service';
import { maybeCreateCommissionForPayment } from '../services/affiliateCommission.service';

export class PaymentController {
  // Initialize Paystack transaction (from backend as per Paystack best practices)
  async initializeTransaction(req: AuthRequest, res: Response) {
    try {
      const { email, reference, callback_url, metadata } = req.body;
      const checkout = metadata?.checkout_data;

      // Validate required fields. The amount is calculated here, not taken from the browser.
      if (!email || !reference || !checkout) {
        return res.status(400).json({
          success: false,
          message: 'Email, payment reference, and checkout details are required',
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

      if (checkout && !checkout.referral && (metadata.referral || req.body.referral)) {
        checkout.referral = metadata.referral || req.body.referral;
      }

      const userId = req.user?.id ?? null;
      const couponId = checkout.coupon_id || null;
      const toPricedItems = (items: any[]) =>
        (items || []).map((item) => ({
          product_id: item.product_id || item.id,
          quantity: Number(item.quantity),
          selected_variants: item.selected_variants,
        }));

      let totalGhs = 0;
      const regularItems = toPricedItems(checkout.regularItems);
      const preOrderItems = toPricedItems(checkout.preOrderItems);

      if (regularItems.length === 0 && preOrderItems.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Your cart is empty',
        });
      }

      if (regularItems.length > 0) {
        const priced = await priceOrder({
          items: regularItems,
          isPreOrder: false,
          deliveryOptionId: checkout.delivery_option?.id ?? null,
          couponId,
          userId,
        });
        totalGhs += priced.total;
      }

      if (preOrderItems.length > 0) {
        const priced = await priceOrder({
          items: preOrderItems,
          isPreOrder: true,
          preOrderShippingOption: checkout.pre_order_shipping_option ?? null,
          couponId: regularItems.length > 0 ? null : couponId,
          userId,
        });
        totalGhs += priced.total;
      }

      const amountPesewas = Math.round(totalGhs * 100);
      if (amountPesewas <= 0) {
        return res.status(400).json({
          success: false,
          message: 'This order does not have an amount that can be paid online',
        });
      }

      // Prepare Paystack initialize transaction payload
      const payload: any = {
        email,
        amount: amountPesewas,
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
      if (error instanceof PricingError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          error: error.code,
        });
      }

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
      const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
      
      if (!paystackSecretKey) {
        console.error('Paystack secret key not configured');
        return res.status(500).json({
          success: false,
          message: 'Paystack secret key not configured',
        });
      }

      // Verify webhook signature (Paystack sends X-Paystack-Signature header)
      const signature = req.headers['x-paystack-signature'];
      if (!signature || Array.isArray(signature)) {
        console.error('Missing Paystack signature in webhook');
        return res.status(400).json({
          success: false,
          message: 'Missing signature',
        });
      }

      const rawBody = req.body;
      if (!Buffer.isBuffer(rawBody)) {
        console.warn('Invalid Paystack webhook signature');
        return res.status(401).json({
          success: false,
          message: 'Invalid signature',
        });
      }

      // HMAC of the raw bytes Paystack signed, not a re-serialized object
      const digest = crypto
        .createHmac('sha512', paystackSecretKey)
        .update(rawBody)
        .digest('hex');
      const digestBuffer = Buffer.from(digest, 'utf8');
      const signatureBuffer = Buffer.from(signature, 'utf8');

      if (
        digestBuffer.length !== signatureBuffer.length ||
        !crypto.timingSafeEqual(digestBuffer, signatureBuffer)
      ) {
        console.warn('Invalid Paystack webhook signature');
        return res.status(401).json({
          success: false,
          message: 'Invalid signature',
        });
      }

      console.log('Paystack webhook signature verified');

      const event = JSON.parse(rawBody.toString('utf8'));
      if (event.data && typeof event.data.metadata === 'string') {
        try {
          event.data.metadata = JSON.parse(event.data.metadata);
        } catch {
          event.data.metadata = {};
        }
      }
      console.log('🔔 Paystack webhook received:', {
        event: event.event,
        reference: event.data?.reference,
        status: event.data?.status,
      });

      const webhookPurpose = event.data?.metadata?.purpose;
      if (
        (event.event === 'charge.success' || event.event === 'transaction.success') &&
        webhookPurpose === 'affiliate_fee'
      ) {
        try {
          await applyAffiliateFeePaid(req, event.data.reference);
        } catch (feeError) {
          if (feeError instanceof AffiliateError && feeError.statusCode < 500) {
            console.error('affiliate fee webhook', feeError.message);
            return res.status(200).json({ success: true, message: 'Webhook processed' });
          }
          console.error('affiliate fee webhook', feeError);
          return res.status(500).json({
            success: false,
            message: 'Failed to process webhook',
          });
        }
        return res.status(200).json({ success: true, message: 'Webhook processed' });
      }

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

          // Create the same orders the payment callback page creates (regular
          // and pre-order separately). createOrder is idempotent per payment
          // reference, so whichever of the two arrives second is a no-op.
          // Prices and totals are recalculated and verified by createOrder.
          const userId = metadata.user_id && metadata.user_id !== 'guest'
            ? metadata.user_id
            : null;

          const toOrderItems = (items: any[]) => (items || []).map((item: any) => ({
            product_id: item.product_id || item.id,
            quantity: item.quantity,
            selected_variants: item.selected_variants || {},
          }));

          const baseBody = {
            payment_method: 'paystack',
            payment_reference: transaction.reference,
            delivery_address: checkoutData.delivery_address,
            customer_bio: checkoutData.customer_bio || null,
            coupon_id: checkoutData.coupon_id || null,
            referral: checkoutData.referral || null,
          };

          const orderBodies: any[] = [];
          if (checkoutData.regularItems?.length) {
            orderBodies.push({
              ...baseBody,
              order_items: toOrderItems(checkoutData.regularItems),
              delivery_option: checkoutData.delivery_option,
              notes: checkoutData.notes || null,
              is_pre_order: false,
            });
          }
          if (checkoutData.preOrderItems?.length) {
            orderBodies.push({
              ...baseBody,
              order_items: toOrderItems(checkoutData.preOrderItems),
              notes: checkoutData.notes || null,
              is_pre_order: true,
              pre_order_shipping_option: checkoutData.pre_order_shipping_option,
              estimated_arrival_date: checkoutData.estimated_arrival_date,
            });
          }

          if (orderBodies.length === 0) {
            console.error('❌ No order items in webhook checkout data');
            return res.json({ success: false, message: 'No order items in checkout data' });
          }

          // Run createOrder without letting it write to Paystack's response
          const runCreateOrder = (body: any) =>
            new Promise<{ status: number; payload: any }>((resolve) => {
              const collector: any = {
                statusCode: 200,
                status(code: number) {
                  this.statusCode = code;
                  return this;
                },
                json(payload: any) {
                  resolve({ status: this.statusCode, payload });
                  return this;
                },
              };
              orderController
                .createOrder({ user: userId ? { id: userId } : undefined, body } as any, collector)
                .catch((error: any) => resolve({ status: 500, payload: { message: error?.message } }));
            });

          const results = [];
          for (const body of orderBodies) {
            results.push(await runCreateOrder(body));
          }

          results.forEach(({ status, payload }) => {
            if (status >= 400) {
              console.error(`❌ Webhook order failed (${status}):`, payload?.message);
            } else {
              console.log(`✅ Webhook order ok: ${payload?.data?.order_number} (${payload?.message})`);
            }
          });

          await maybeCreateCommissionForPayment(req, transaction.reference);

          // 5xx asks Paystack to retry later; anything else is final
          const retry = results.some(({ status }) => status >= 500);
          return res.status(retry ? 500 : 200).json({
            success: !retry,
            message: 'Webhook processed',
          });

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
}
