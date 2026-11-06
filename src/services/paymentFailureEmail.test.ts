import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setSupabaseAdminForTests, supabaseAdmin as originalAdmin } from '../utils/supabaseClient';
import { createMemorySupabase } from '../test/memorySupabase';
import {
  isPaystackDeclinedCharge,
  shouldSendPaymentFailureEmail,
} from './paymentFailureEmail.logic';
import {
  maybeNotifyPaymentFailure,
  sendPaymentFailureEmailOnce,
} from './paymentFailureEmail.service';
import enhancedEmailService from './enhanced-email.service';

describe('payment failure email gates', () => {
  it('treats only raw Paystack status failed as a declined charge', () => {
    assert.equal(isPaystackDeclinedCharge('failed'), true);
    assert.equal(isPaystackDeclinedCharge('Failed'), true);
    assert.equal(isPaystackDeclinedCharge('abandoned'), false);
    assert.equal(isPaystackDeclinedCharge('pending'), false);
    assert.equal(isPaystackDeclinedCharge('ongoing'), false);
    assert.equal(isPaystackDeclinedCharge('processing'), false);
    assert.equal(isPaystackDeclinedCharge('queued'), false);
    assert.equal(isPaystackDeclinedCharge('success'), false);
    assert.equal(isPaystackDeclinedCharge('reversed'), false);
    assert.equal(isPaystackDeclinedCharge(''), false);
    assert.equal(isPaystackDeclinedCharge(null), false);
  });

  it('requires an existing order id and declined status', () => {
    assert.equal(
      shouldSendPaymentFailureEmail({ rawPaystackStatus: 'failed', orderId: 'ord-1' }),
      true
    );
    assert.equal(
      shouldSendPaymentFailureEmail({ rawPaystackStatus: 'failed', orderId: null }),
      false
    );
    assert.equal(
      shouldSendPaymentFailureEmail({ rawPaystackStatus: 'abandoned', orderId: 'ord-1' }),
      false
    );
    assert.equal(
      shouldSendPaymentFailureEmail({ rawPaystackStatus: 'pending', orderId: 'ord-1' }),
      false
    );
  });
});

describe('payment failure email once-per-reference', () => {
  let sendCalls = 0;
  let originalSend: typeof enhancedEmailService.sendPaymentProblem;

  before(() => {
    const db = createMemorySupabase();
    setSupabaseAdminForTests(db as any);
    originalSend = enhancedEmailService.sendPaymentProblem.bind(enhancedEmailService);
    enhancedEmailService.sendPaymentProblem = async () => {
      sendCalls += 1;
      return { success: true };
    };
  });

  after(() => {
    enhancedEmailService.sendPaymentProblem = originalSend;
    setSupabaseAdminForTests(originalAdmin);
  });

  it('sends at most once per reference via jobs_runs', async () => {
    sendCalls = 0;
    const order = {
      id: 'ord-fail-1',
      order_number: 'ORD-FAIL-1',
      customer_email: 'ama@example.test',
      customer_name: 'Ama',
      total: 500,
      payment_method: 'paystack',
      payment_status: 'failed',
    };
    const first = await sendPaymentFailureEmailOnce('REF_FAIL_ONCE', order);
    const second = await sendPaymentFailureEmailOnce('REF_FAIL_ONCE', order);
    assert.equal(first, 'sent');
    assert.equal(second, 'skipped');
    assert.equal(sendCalls, 1);
  });

  it('skips abandoned, pending, and missing orders without sending', async () => {
    sendCalls = 0;
    const abandoned = await maybeNotifyPaymentFailure({
      rawPaystackStatus: 'abandoned',
      orderId: 'ord-1',
      reference: 'REF_ABANDONED',
      loadOrder: async () => {
        throw new Error('loadOrder must not run for abandoned');
      },
    });
    const pending = await maybeNotifyPaymentFailure({
      rawPaystackStatus: 'pending',
      orderId: 'ord-1',
      reference: 'REF_PENDING',
      loadOrder: async () => {
        throw new Error('loadOrder must not run for pending');
      },
    });
    const noOrder = await maybeNotifyPaymentFailure({
      rawPaystackStatus: 'failed',
      orderId: null,
      reference: 'REF_NO_ORDER',
      loadOrder: async () => {
        throw new Error('loadOrder must not run without order');
      },
    });
    assert.equal(abandoned, 'skipped');
    assert.equal(pending, 'skipped');
    assert.equal(noOrder, 'skipped');
    assert.equal(sendCalls, 0);
  });
});
