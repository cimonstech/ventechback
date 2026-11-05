import '../testenv';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isOrderNumberUniqueViolation,
  isPaystackTransactionUniqueViolation,
  isPaymentReferenceUniqueViolation,
  orderIsPreOrder,
  paymentReferenceUniqueKey,
  uniqueViolationForPaymentInsert,
} from './orderPayment.logic';

describe('order payment uniqueness helpers', () => {
  it('treats shipping_address.is_pre_order as the pre-order flag', () => {
    assert.equal(orderIsPreOrder({ shipping_address: { is_pre_order: true } }), true);
    assert.equal(orderIsPreOrder({ shipping_address: {} }), false);
    assert.equal(
      paymentReferenceUniqueKey('REF1', false) !== paymentReferenceUniqueKey('REF1', true),
      true
    );
  });

  it('recognises the payment-reference unique index', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "orders_payment_reference_preorder_uidx"',
    };
    assert.equal(isPaymentReferenceUniqueViolation(error), true);
    assert.equal(uniqueViolationForPaymentInsert(error, 'REF1'), true);
    assert.equal(uniqueViolationForPaymentInsert(error, null), false);
    assert.equal(
      uniqueViolationForPaymentInsert(
        {
          code: '23505',
          message: 'duplicate key value violates unique constraint "orders_order_number_key"',
        },
        'REF1'
      ),
      false
    );
    assert.equal(
      isOrderNumberUniqueViolation({
        code: '23505',
        message: 'duplicate key value violates unique constraint "orders_order_number_key"',
      }),
      true
    );
  });

  it('recognises the paystack transaction unique index', () => {
    assert.equal(
      isPaystackTransactionUniqueViolation({
        code: '23505',
        message: 'duplicate key value violates unique constraint "transactions_paystack_reference_uidx"',
      }),
      true
    );
  });
});
