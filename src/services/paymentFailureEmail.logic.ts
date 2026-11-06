/**
 * Payment-failure customer email gates.
 * Only a Paystack charge status of exactly "failed" (declined) may notify.
 * Never abandoned (closed popup), pending/ongoing, success, timeouts, or unknown mapped leftovers.
 */
export function isPaystackDeclinedCharge(rawStatus: unknown): boolean {
  return String(rawStatus || '').trim().toLowerCase() === 'failed';
}

export function shouldSendPaymentFailureEmail(input: {
  rawPaystackStatus: unknown;
  orderId: string | null | undefined;
}): boolean {
  if (!input.orderId) return false;
  return isPaystackDeclinedCharge(input.rawPaystackStatus);
}
