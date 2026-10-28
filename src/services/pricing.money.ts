export const FREE_DELIVERY_THRESHOLD = 20000;
export const PRE_ORDER_SHIPPING_PRICES: Record<string, number> = {
  air_cargo: 400,
  ship_cargo: 200,
};

export function ghsToPesewas(ghs: number): number {
  return Math.round(Number(ghs) * 100);
}

export function paymentCoversOrderTotals(orderTotalsGhs: number[], paidPesewas: number): boolean {
  const expectedPesewas = orderTotalsGhs.reduce(
    (sum, total) => sum + ghsToPesewas(Number(total) || 0),
    0
  );
  return expectedPesewas <= paidPesewas;
}
