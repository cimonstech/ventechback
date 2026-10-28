import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FREE_DELIVERY_THRESHOLD,
  PRE_ORDER_SHIPPING_PRICES,
  ghsToPesewas,
  paymentCoversOrderTotals,
} from './pricing.money';

const round2 = (n: number) => Math.round(n * 100) / 100;

describe('paymentCoversOrderTotals', () => {
  it('covers a single order when paid pesewas match the rounded total', () => {
    const total = 150.5;
    const paidPesewas = ghsToPesewas(total);
    assert.equal(paidPesewas, 15050);
    assert.equal(paymentCoversOrderTotals([total], paidPesewas), true);
    assert.equal(paymentCoversOrderTotals([total], paidPesewas - 1), false);
  });

  it('sums each split checkout order in pesewas before comparing', () => {
    const regularSubtotal = 850.4;
    const regularDelivery = 50;
    const regularTotal = round2(regularSubtotal + regularDelivery);
    const preOrderSubtotal = 1200.25;
    const preOrderDelivery = PRE_ORDER_SHIPPING_PRICES.air_cargo;
    const preOrderTotal = round2(preOrderSubtotal + preOrderDelivery);
    const paidPesewas = ghsToPesewas(regularTotal) + ghsToPesewas(preOrderTotal);

    assert.equal(paymentCoversOrderTotals([regularTotal, preOrderTotal], paidPesewas), true);
    assert.equal(paymentCoversOrderTotals([regularTotal, preOrderTotal], paidPesewas - 1), false);
  });

  it('applies a coupon to the order total before converting to pesewas', () => {
    const subtotal = 1500;
    const discount = 200;
    const delivery = 50;
    const total = round2(Math.max(subtotal + delivery - discount, 0));
    assert.equal(total, 1350);
    assert.equal(ghsToPesewas(total), 135000);
    assert.equal(paymentCoversOrderTotals([total], 135000), true);
    assert.equal(paymentCoversOrderTotals([total], 134999), false);
  });

  it('drops delivery at the GHS 20,000 free-delivery threshold', () => {
    assert.equal(FREE_DELIVERY_THRESHOLD, 20000);
    const paidDelivery = 50;
    const atThreshold = round2(FREE_DELIVERY_THRESHOLD);
    const belowThreshold = round2(19999 + paidDelivery);

    assert.equal(ghsToPesewas(atThreshold), 2_000_000);
    assert.equal(paymentCoversOrderTotals([atThreshold], 2_000_000), true);
    assert.equal(ghsToPesewas(belowThreshold), 2_004_900);
    assert.equal(paymentCoversOrderTotals([belowThreshold], 2_004_900), true);
    assert.equal(paymentCoversOrderTotals([belowThreshold], 1_999_900), false);
  });
});
