export function orderIsPreOrder(order: {
  is_pre_order?: unknown;
  shipping_address?: { is_pre_order?: unknown } | null;
}): boolean {
  return !!(order.is_pre_order || order.shipping_address?.is_pre_order);
}

export function paymentReferenceUniqueKey(
  paymentReference: string,
  isPreOrder: boolean
): string {
  return `${paymentReference}\0${isPreOrder ? '1' : '0'}`;
}

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const row = error as { message?: unknown; details?: unknown; hint?: unknown };
  return `${row.message || ''} ${row.details || ''} ${row.hint || ''}`;
}

export function isPgUniqueViolation(error: unknown): boolean {
  return !!(error && typeof error === 'object' && (error as { code?: string }).code === '23505');
}

export function isPaymentReferenceUniqueViolation(error: unknown): boolean {
  if (!isPgUniqueViolation(error)) return false;
  const text = errorText(error).toLowerCase();
  return (
    text.includes('orders_payment_reference_preorder_uidx') ||
    (text.includes('payment_reference') && (text.includes('preorder') || text.includes('is_pre_order')))
  );
}

export function isPaystackTransactionUniqueViolation(error: unknown): boolean {
  if (!isPgUniqueViolation(error)) return false;
  const text = errorText(error).toLowerCase();
  return (
    text.includes('transactions_paystack_reference_uidx') ||
    text.includes('transactions_transaction_reference_key') ||
    text.includes('paystack_reference') ||
    text.includes('transaction_reference')
  );
}

export function isOrderNumberUniqueViolation(error: unknown): boolean {
  if (!isPgUniqueViolation(error)) return false;
  const text = errorText(error).toLowerCase();
  return text.includes('orders_order_number_key') || /\border_number\b/.test(text);
}

export function uniqueViolationForPaymentInsert(
  error: unknown,
  paymentReference: string | null
): boolean {
  return !!paymentReference && isPaymentReferenceUniqueViolation(error);
}
