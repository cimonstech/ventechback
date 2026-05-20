export const normalizePaymentMethod = (
  paymentMethodRaw: any
): any | null => {
  if (!paymentMethodRaw) {
    return null;
  }

  const paymentMethod = Array.isArray(paymentMethodRaw)
    ? paymentMethodRaw[0]
    : paymentMethodRaw;

  if (!paymentMethod || !paymentMethod.id) {
    return null;
  }

  return paymentMethod;
};
