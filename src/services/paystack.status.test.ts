import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapPaystackChargeStatus, paystackChargeMessage } from './paystack.status';

describe('mapPaystackChargeStatus', () => {
  it('maps Paystack statuses to the four shopper statuses', () => {
    assert.equal(mapPaystackChargeStatus('success'), 'success');
    assert.equal(mapPaystackChargeStatus('abandoned'), 'abandoned');
    assert.equal(mapPaystackChargeStatus('pending'), 'pending');
    assert.equal(mapPaystackChargeStatus('ongoing'), 'pending');
    assert.equal(mapPaystackChargeStatus('processing'), 'pending');
    assert.equal(mapPaystackChargeStatus('queued'), 'pending');
    assert.equal(mapPaystackChargeStatus('failed'), 'failed');
    assert.equal(mapPaystackChargeStatus('reversed'), 'failed');
    assert.equal(mapPaystackChargeStatus(''), 'failed');
  });

  it('uses plain shopper copy, never Paystack wording', () => {
    assert.equal(paystackChargeMessage('failed').includes('Paystack'), false);
    assert.match(paystackChargeMessage('pending', 'VENTECH_1'), /VENTECH_1/);
  });
});
