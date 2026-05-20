// Affiliate Payout Processor Service
// Handles integration between affiliate payouts and Paystack payment processing

import axios from 'axios';
import { supabaseAdmin } from '../utils/supabaseClient';

interface PayoutRecipient {
  type: 'nuban' | 'mobile_money' | 'crypto';
  account_number?: string;
  bank_code?: string;
  mobile_number?: string;
  crypto_address?: string;
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
  method_type: 'bank' | 'momo' | 'crypto';
  account_name: string;
  provider: string;
  is_default: boolean;
}

export class AffiliatePayoutProcessor {
  private paystackSecretKey: string;
  private paystackBaseUrl = 'https://api.paystack.co';
  private enabled: boolean;

  constructor() {
    this.paystackSecretKey = process.env.PAYSTACK_SECRET_KEY || '';
    this.enabled = Boolean(this.paystackSecretKey);

    if (!this.enabled) {
      console.warn('⚠️ [PAYOUT] Paystack payout processing disabled because PAYSTACK_SECRET_KEY is not configured');
    }
  }

  private ensurePaystackConfigured(): void {
    if (!this.enabled) {
      throw new Error('Paystack payout processing is disabled because PAYSTACK_SECRET_KEY is not configured');
    }
  }

  /**
   * Process a pending payout request
   * Initiates Paystack transfer to the affiliate's payment method
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
  async verifyTransferStatus(reference: string): Promise<any> {
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
}

export const affiliatePayoutProcessor = new AffiliatePayoutProcessor();
