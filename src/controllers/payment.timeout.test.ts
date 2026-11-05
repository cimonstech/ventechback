import '../testenv';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { PaymentController } from './payment.controller';
import { PAYSTACK_INITIALIZE_FAILED, paystackClient, paystackVerifyTimeoutMessage } from '../services/paystackClient';
import { PricingError, verifyPaystackPayment } from '../services/pricing.service';
import { setSupabaseAdminForTests, supabaseAdmin as originalAdmin } from '../utils/supabaseClient';
import { createMemorySupabase } from '../test/memorySupabase';

const PRODUCT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function timeoutError() {
  const error: any = new Error('timeout of 15000ms exceeded');
  error.code = 'ECONNABORTED';
  error.isAxiosError = true;
  return error;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  return res;
}

describe('Paystack checkout timeouts', () => {
  let restoreAdapter: (() => void) | undefined;

  before(() => {
    const db = createMemorySupabase({
      products: [
        {
          id: PRODUCT_ID,
          name: 'Laptop',
          price: 500,
          discount_price: 500,
          thumbnail: '',
          images: [],
          stock_quantity: 5,
          in_stock: true,
        },
      ],
      delivery_options: [{ id: 'delivery-1', name: 'Accra', price: 50, is_active: true, display_order: 1 }],
    });
    setSupabaseAdminForTests(db as any);
    const originalAdapter = (paystackClient.defaults as any).adapter;
    paystackClient.defaults.adapter = async () => {
      throw timeoutError();
    };
    restoreAdapter = () => {
      paystackClient.defaults.adapter = originalAdapter;
    };
  });

  after(() => {
    restoreAdapter?.();
    setSupabaseAdminForTests(originalAdmin);
  });

  it('initialize returns 502 without retrying', async () => {
    const controller = new PaymentController();
    const res = mockRes();
    await controller.initializeTransaction(
      {
        body: {
          email: 'ama@example.test',
          reference: 'INIT_TIMEOUT_REF',
          metadata: {
            checkout_data: {
              regularItems: [{ product_id: PRODUCT_ID, quantity: 1, selected_variants: {} }],
              preOrderItems: [],
              delivery_option: { id: 'delivery-1' },
            },
          },
        },
        user: null,
      } as any,
      res
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.message, PAYSTACK_INITIALIZE_FAILED);
  });

  it('verify returns 502 with the charged-copy including the reference', async () => {
    const controller = new PaymentController();
    const res = mockRes();
    const reference = 'VERIFY_TIMEOUT_REF';
    await controller.verifyTransaction({ body: { reference } } as any, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body?.message, paystackVerifyTimeoutMessage(reference));
  });

  it('verifyPaystackPayment classifies timeout as 502', async () => {
    await assert.rejects(
      () => verifyPaystackPayment('CREATE_ORDER_TIMEOUT_REF'),
      (error: unknown) => {
        assert.ok(error instanceof PricingError);
        assert.equal(error.statusCode, 502);
        assert.equal(error.code, 'PAYSTACK_TIMEOUT');
        assert.equal(error.message, paystackVerifyTimeoutMessage('CREATE_ORDER_TIMEOUT_REF'));
        return true;
      }
    );
  });
});
