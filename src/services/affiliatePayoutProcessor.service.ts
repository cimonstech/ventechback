// Affiliate Payout Processor Service
// Handles integration between affiliate payouts and Paystack payment processing

import axios from 'axios';
import { supabaseAdmin } from '../utils/supabaseClient';

interface PayoutRecipient {
  type: 'nuban' | 'mobile_money' | 'crypto' | 'paypal';
  account_number?: string;
  bank_code?: string;
  mobile_number?: string;
  crypto_address?: string;
  email?: string;
}

interface PayoutRequest {
  id: string;
  affiliate_id: string;
  amount: number;
  payout_method_id: string;
  method: string;
  status: string;
}

interface PaymentMethod {
  id: string;
  method_type: 'bank' | 'momo' | 'crypto' | 'paypal';
  account_name: string;
  provider: string;
  is_default: boolean;
}

export class AffiliatePayoutProcessor {
  private paystackSecretKey: string;
  private paystackBaseUrl = 'https://api.paystack.co';
  private paypalClientId: string;
  private paypalClientSecret: string;
  private paypalBaseUrl: string;
  private paypalPayoutCurrency: string;
  private enabled: boolean;
  private paypalEnabled: boolean;

  constructor() {
    this.paystackSecretKey = process.env.PAYSTACK_SECRET_KEY || '';
    this.paypalClientId = process.env.PAYPAL_CLIENT_ID || '';
    this.paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET || '';
    this.paypalBaseUrl = process.env.PAYPAL_API_BASE || 'https://api-m.paypal.com';
    this.paypalPayoutCurrency = process.env.PAYPAL_PAYOUT_CURRENCY || 'USD';
    this.enabled = Boolean(this.paystackSecretKey);
    this.paypalEnabled = Boolean(this.paypalClientId && this.paypalClientSecret);

    if (!this.enabled) {
      console.warn('⚠️ [PAYOUT] Paystack payout processing disabled because PAYSTACK_SECRET_KEY is not configured');
    }

    if (!this.paypalEnabled) {
      console.warn('⚠️ [PAYOUT] PayPal payout processing disabled because PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not configured');
    }
  }

  private ensurePaystackConfigured(): void {
    if (!this.enabled) {
      throw new Error('Paystack payout processing is disabled because PAYSTACK_SECRET_KEY is not configured');
    }
  }

  private ensurePayPalConfigured(): void {
    if (!this.paypalEnabled) {
      throw new Error('PayPal payout processing is disabled because PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is not configured');
    }
  }

  /**
   * Process a pending payout request
   * Initiates Paystack transfer or PayPal payout for the affiliate's payment method
   */
  async processPayout(payoutRequest: PayoutRequest, paymentMethod: PaymentMethod): Promise<any> {
    try {
      this.ensurePaystackConfigured();
      console.log(`💳 [PAYOUT] Processing payout ${payoutRequest.id} for amount GHS${payoutRequest.amount}`);

      // Get affiliate details
      const { data: affiliate, error: affiliateError } = await supabaseAdmin
        .from('affiliates')
        .select('id, user_id, referral_code')
        .eq('id', payoutRequest.affiliate_id)
        .single();

      if (affiliateError || !affiliate) {
        throw new Error('Affiliate not found');
      }

      // Get user email for reference
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('id', affiliate.user_id)
        .single();

      // Parse payment method details
      const paymentDetails = this.parsePaymentDetails(paymentMethod);

      if (paymentDetails.type === 'paypal') {
        this.ensurePayPalConfigured();

        const reference = `PAYPAL_${payoutRequest.id.substring(0, 8)}_${Date.now()}`;
        const payoutResponse = await this.initiatePayPalPayout({
          recipientEmail: paymentDetails.email!,
          amount: payoutRequest.amount,
          currency: this.paypalPayoutCurrency,
          reference,
          note: `Affiliate commission payout for ${affiliate.referral_code}`,
        });

        const payoutReference = payoutResponse.batch_header?.payout_batch_id || reference;
        console.log(`✅ [PAYOUT] PayPal payout initiated: ${payoutReference}`);

        const { error: updateError } = await supabaseAdmin
          .from('payout_requests')
          .update({
            status: 'processing',
            reference: payoutReference,
            updated_at: new Date().toISOString(),
          })
          .eq('id', payoutRequest.id);

        if (updateError) {
          console.error(`❌ [PAYOUT] Failed to update payout status: ${updateError.message}`);
        }

        return {
          success: true,
          reference: payoutReference,
          amount: payoutRequest.amount,
          message: 'PayPal payout initiated successfully',
        };
      }

      // Create Paystack transfer recipient
      const recipientCode = await this.createOrGetRecipient(paymentMethod, paymentDetails);

      // Initiate transfer
      const transferResponse = await this.initiateTransfer({
        recipient: recipientCode,
        amount: Math.round(payoutRequest.amount * 100), // Convert to kobo/cents
        reason: `Affiliate commission payout for ${affiliate.referral_code}`,
        reference: `AFFL_${payoutRequest.id.substring(0, 8)}_${Date.now()}`,
      });

      if (transferResponse.status && transferResponse.data) {
        console.log(`✅ [PAYOUT] Transfer initiated: ${transferResponse.data.reference}`);

        // Update payout status to processing
        const { error: updateError } = await supabaseAdmin
          .from('payout_requests')
          .update({
            status: 'processing',
            reference: transferResponse.data.reference,
            updated_at: new Date().toISOString(),
          })
          .eq('id', payoutRequest.id);

        if (updateError) {
          console.error(`❌ [PAYOUT] Failed to update payout status: ${updateError.message}`);
        }

        return {
          success: true,
          reference: transferResponse.data.reference,
          amount: payoutRequest.amount,
          message: 'Payout initiated successfully',
        };
      } else {
        throw new Error(transferResponse.message || 'Failed to initiate transfer');
      }
    } catch (error: any) {
      console.error(`❌ [PAYOUT] Error processing payout: ${error.message}`);

      // Update payout status to failed
      await supabaseAdmin
        .from('payout_requests')
        .update({
          status: 'failed',
          error_message: error.message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payoutRequest.id);

      throw error;
    }
  }

  /**
   * Parse payment method details into structured format
   */
  private parsePaymentDetails(paymentMethod: PaymentMethod): PayoutRecipient {
    const details = paymentMethod.provider;

    if (paymentMethod.method_type === 'bank') {
      // Format: "BANK_CODE:ACCOUNT_NUMBER"
      const [bankCode, accountNumber] = details.split(':');
      return {
        type: 'nuban',
        account_number: accountNumber,
        bank_code: bankCode,
      };
    } else if (paymentMethod.method_type === 'momo') {
      // Format: "MOBILE_NUMBER" or "PROVIDER:MOBILE_NUMBER"
      const parts = details.split(':');
      const mobileNumber = parts.length > 1 ? parts[1] : parts[0];
      return {
        type: 'mobile_money',
        mobile_number: mobileNumber,
      };
    } else if (paymentMethod.method_type === 'crypto') {
      // Format: "CRYPTO_ADDRESS"
      return {
        type: 'crypto',
        crypto_address: details,
      };
    } else if (paymentMethod.method_type === 'paypal') {
      // Format: "PAYPAL_EMAIL"
      return {
        type: 'paypal',
        email: details,
      };
    }

    throw new Error('Invalid payment method type');
  }

  /**
   * Create or get existing Paystack recipient for payment method
   */
  private async createOrGetRecipient(
    paymentMethod: PaymentMethod,
    paymentDetails: PayoutRecipient
  ): Promise<string> {
    this.ensurePaystackConfigured();
    try {
      const recipientName = paymentMethod.account_name;
      let recipientData: any = {
        type: paymentDetails.type,
        name: recipientName,
      };

      if (paymentDetails.type === 'nuban') {
        recipientData.account_number = paymentDetails.account_number;
        recipientData.bank_code = paymentDetails.bank_code;
      } else if (paymentDetails.type === 'mobile_money') {
        recipientData.details = {
          mobile_number: paymentDetails.mobile_number,
        };
      } else if (paymentDetails.type === 'crypto') {
        recipientData.details = {
          crypto_address: paymentDetails.crypto_address,
        };
      }

      const response = await axios.post(
        `${this.paystackBaseUrl}/transferrecipient`,
        recipientData,
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data.status && response.data.data) {
        console.log(`✅ [PAYSTACK] Recipient created/retrieved: ${response.data.data.recipient_code}`);
        return response.data.data.recipient_code;
      } else {
        throw new Error(response.data.message || 'Failed to create recipient');
      }
    } catch (error: any) {
      console.error(`❌ [PAYSTACK] Recipient error: ${error.response?.data?.message || error.message}`);
      throw error;
    }
  }

  /**
   * Initiate Paystack transfer
   */
  private async initiateTransfer(transferData: {
    recipient: string;
    amount: number;
    reason: string;
    reference: string;
  }): Promise<any> {
    this.ensurePaystackConfigured();
    try {
      console.log(`📤 [PAYSTACK] Initiating transfer to recipient: ${transferData.recipient}`);

      const response = await axios.post(
        `${this.paystackBaseUrl}/transfer`,
        {
          recipient: transferData.recipient,
          amount: transferData.amount,
          reason: transferData.reason,
          reference: transferData.reference,
        },
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`✅ [PAYSTACK] Transfer response:`, response.data);
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      console.error(`❌ [PAYSTACK] Transfer error: ${errorMessage}`);
      throw new Error(`Paystack transfer failed: ${errorMessage}`);
    }
  }

  /**
   * Get pending payouts ready for processing
   */
  async getPendingPayouts(): Promise<any[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('payout_requests')
        .select(
          `
          id,
          affiliate_id,
          amount,
          payout_method_id,
          method,
          status,
          created_at,
          payout_methods (
            id,
            method_type,
            account_name,
            provider,
            is_default
          )
        `
        )
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (error) {
        throw new Error(`Failed to fetch pending payouts: ${error.message}`);
      }

      return data || [];
    } catch (error: any) {
      console.error(`❌ [PAYOUT] Error fetching pending payouts: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify Paystack transfer status
   */
  async verifyTransferStatus(reference: string, methodType?: string): Promise<any> {
    if (methodType === 'paypal' || reference.startsWith('PAYPAL_')) {
      return this.verifyPayPalPayoutStatus(reference);
    }

    this.ensurePaystackConfigured();
    try {
      const response = await axios.get(`${this.paystackBaseUrl}/transfer/verify/${reference}`, {
        headers: {
          Authorization: `Bearer ${this.paystackSecretKey}`,
        },
      });

      console.log(`📋 [PAYSTACK] Transfer status for ${reference}:`, response.data.data.status);
      return response.data.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      console.error(`❌ [PAYSTACK] Verify transfer error: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Update payout status based on Paystack verification
   */
  async updatePayoutFromPaystack(payoutId: string, paystackStatus: string): Promise<void> {
    const statusMap: Record<string, string> = {
      success: 'completed',
      failed: 'failed',
      pending: 'processing',
      cancelled: 'cancelled',
      SUCCESS: 'completed',
      DENIED: 'failed',
      FAILED: 'failed',
      PENDING: 'processing',
      PROCESSING: 'processing',
      UNCLAIMED: 'failed',
    };

    const newStatus = statusMap[paystackStatus] || 'processing';

    const { error } = await supabaseAdmin
      .from('payout_requests')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payoutId);

    if (error) {
      throw new Error(`Failed to update payout status: ${error.message}`);
    }

    console.log(`✅ [PAYOUT] Updated payout ${payoutId} to status: ${newStatus}`);
  }

  private async getPayPalAccessToken(): Promise<string> {
    this.ensurePayPalConfigured();

    const response = await axios.post(
      `${this.paypalBaseUrl}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        auth: {
          username: this.paypalClientId,
          password: this.paypalClientSecret,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (!response.data?.access_token) {
      throw new Error('Failed to retrieve PayPal access token');
    }

    return response.data.access_token;
  }

  private async initiatePayPalPayout(data: {
    recipientEmail: string;
    amount: number;
    currency: string;
    reference: string;
    note: string;
  }): Promise<any> {
    const accessToken = await this.getPayPalAccessToken();
    try {
      const response = await axios.post(
        `${this.paypalBaseUrl}/v1/payments/payouts`,
        {
          sender_batch_header: {
            sender_batch_id: data.reference,
            email_subject: 'Your affiliate payout is being sent',
            email_message: 'A payout was requested from your affiliate account.',
          },
          items: [
            {
              recipient_type: 'EMAIL',
              amount: {
                value: data.amount.toFixed(2),
                currency: data.currency,
              },
              receiver: data.recipientEmail,
              note: data.note,
              sender_item_id: data.reference,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.data || !response.data.batch_header) {
        throw new Error('PayPal payout response was invalid');
      }

      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      console.error(`❌ [PAYPAL] Payout error: ${errorMessage}`);
      throw new Error(`PayPal payout failed: ${errorMessage}`);
    }
  }

  private async verifyPayPalPayoutStatus(reference: string): Promise<any> {
    this.ensurePayPalConfigured();

    try {
      const accessToken = await this.getPayPalAccessToken();
      const response = await axios.get(`${this.paypalBaseUrl}/v1/payments/payouts/${reference}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const status = response.data?.batch_header?.batch_status || 'PENDING';
      console.log(`📋 [PAYPAL] Payout status for ${reference}:`, status);

      return {
        status,
        batch_header: response.data.batch_header,
        items: response.data.items,
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      console.error(`❌ [PAYPAL] Verify payout error: ${errorMessage}`);
      throw new Error(`PayPal payout verification failed: ${errorMessage}`);
    }
  }
}

export const affiliatePayoutProcessor = new AffiliatePayoutProcessor();
