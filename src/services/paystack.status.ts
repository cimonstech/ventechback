export type PaystackChargeStatus = 'success' | 'failed' | 'abandoned' | 'pending';

export function mapPaystackChargeStatus(status: unknown): PaystackChargeStatus {
  const value = String(status || '').toLowerCase();
  if (value === 'success') return 'success';
  if (value === 'abandoned') return 'abandoned';
  if (value === 'pending' || value === 'ongoing' || value === 'processing' || value === 'queued') {
    return 'pending';
  }
  return 'failed';
}

export function paystackChargeMessage(status: PaystackChargeStatus, reference?: string): string {
  if (status === 'success') return 'Payment successful.';
  if (status === 'abandoned') return 'Payment was cancelled. Your cart is still here.';
  if (status === 'pending') {
    return reference
      ? `We're still waiting for this payment. If you were charged, contact support with reference ${reference}. You won't be charged twice.`
      : "We're still waiting for this payment. If you were charged, contact support with your payment reference. You won't be charged twice.";
  }
  return "This payment didn't go through. You haven't been charged. Try again, or pick another method.";
}
