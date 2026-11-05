import '../testenv';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { OrderController } from './order.controller';
import { paystackClient } from '../services/paystackClient';
import { setSupabaseAdminForTests, supabaseAdmin as originalAdmin } from '../utils/supabaseClient';
import { createMemorySupabase } from '../test/memorySupabase';
import { clearFeatureFlagsCache } from '../services/featureFlags.service';
import enhancedEmailService from '../services/enhanced-email.service';

const PRODUCT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PRE_PRODUCT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REFERENCE = 'TEST_RACE_REF_001';

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function orderBody(isPreOrder: boolean) {
  return {
    payment_method: 'paystack',
    payment_reference: REFERENCE,
    delivery_address: {
      recipient_name: 'Ama',
      phone: '0200000000',
      email: 'ama@example.test',
      address: 'Accra',
    },
    customer_bio: { name: 'Ama', email: 'ama@example.test', phone: '0200000000' },
    order_items: [
      {
        product_id: isPreOrder ? PRE_PRODUCT_ID : PRODUCT_ID,
        quantity: 1,
        selected_variants: {},
      },
    ],
    is_pre_order: isPreOrder,
    pre_order_shipping_option: isPreOrder ? 'air_cargo' : undefined,
    delivery_option: isPreOrder ? undefined : { id: 'delivery-1', name: 'Accra', price: 50 },
  };
}

describe('createOrder payment uniqueness', () => {
  let restoreAdapter: (() => void) | undefined;
  let restoreMail: (() => void) | undefined;

  before(() => {
    const send = async () => ({ success: true, skipped: true, reason: 'test' });
    const originalConfirm = enhancedEmailService.sendOrderConfirmation.bind(enhancedEmailService);
    const originalAdminMail = enhancedEmailService.sendAdminOrderNotification.bind(enhancedEmailService);
    (enhancedEmailService as any).sendOrderConfirmation = send;
    (enhancedEmailService as any).sendAdminOrderNotification = send;
    restoreMail = () => {
      (enhancedEmailService as any).sendOrderConfirmation = originalConfirm;
      (enhancedEmailService as any).sendAdminOrderNotification = originalAdminMail;
    };

    const originalAdapter = (paystackClient.defaults as any).adapter;
    paystackClient.defaults.adapter = async (config: any) => ({
      data: {
        status: true,
        data: {
          status: 'success',
          amount: 10_000_000,
          currency: 'GHS',
          reference: REFERENCE,
        },
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });
    restoreAdapter = () => {
      paystackClient.defaults.adapter = originalAdapter;
    };
  });

  after(() => {
    restoreAdapter?.();
    restoreMail?.();
    setSupabaseAdminForTests(originalAdmin);
  });

  function seedDb() {
    clearFeatureFlagsCache();
    const db = createMemorySupabase({
      products: [
        {
          id: PRODUCT_ID,
          name: 'In-stock laptop',
          price: 20000,
          discount_price: 20000,
          thumbnail: '',
          images: [],
          stock_quantity: 10,
          in_stock: true,
          category_id: 'cat-laptops',
        },
        {
          id: PRE_PRODUCT_ID,
          name: 'Pre-order laptop',
          price: 20000,
          discount_price: 20000,
          thumbnail: '',
          images: [],
          stock_quantity: 0,
          in_stock: false,
          category_id: 'cat-laptops',
        },
      ],
      delivery_options: [{ id: 'delivery-1', name: 'Accra', price: 50, is_active: true, display_order: 1 }],
      settings: [{ key: 'feature_affiliates_enabled', value: 'false', category: 'features' }],
    });
    setSupabaseAdminForTests(db as any);
    return db;
  }

  it('two concurrent regular createOrder calls keep one order, one stock decrement, one transaction', async () => {
    const db = seedDb();
    const controller = new OrderController();
    const req = { body: orderBody(false), user: null } as any;

    const [resA, resB] = [mockRes(), mockRes()];
    await Promise.all([controller.createOrder(req, resA), controller.createOrder({ ...req, body: { ...req.body } }, resB)]);

    assert.equal(resA.statusCode, 200);
    assert.equal(resB.statusCode, 200);
    assert.equal(resA.body?.success, true);
    assert.equal(resB.body?.success, true);
    assert.equal(db.tables.orders.length, 1);
    assert.equal(resA.body.data.order_number, resB.body.data.order_number);
    assert.equal(db.stats.stockDecrements, 1);
    assert.equal(db.tables.products[0].stock_quantity, 9);
    assert.equal(db.tables.transactions.length, 1);
    assert.equal(db.tables.affiliate_commissions.length, 0);
  });

  it('a mixed cart can still create one regular and one pre-order for the same reference', async () => {
    const db = seedDb();
    const controller = new OrderController();
    const regularRes = mockRes();
    const preRes = mockRes();
    await Promise.all([
      controller.createOrder({ body: orderBody(false), user: null } as any, regularRes),
      controller.createOrder({ body: orderBody(true), user: null } as any, preRes),
    ]);

    assert.equal(regularRes.body?.success, true);
    assert.equal(preRes.body?.success, true);
    assert.equal(db.tables.orders.length, 2);
    const flags = db.tables.orders.map((row: any) => !!row.shipping_address?.is_pre_order).sort();
    assert.deepEqual(flags, [false, true]);
    assert.equal(db.stats.stockDecrements, 1);
    assert.equal(db.tables.transactions.length, 1);
    assert.notEqual(regularRes.body.data.order_number, preRes.body.data.order_number);
  });
});
