/**
 * Fire the payment-callback createOrder path and the Paystack webhook
 * path at the same time against STAGING. Does not hit production.
 *
 *   npx ts-node --transpile-only scripts/race-checkout.ts
 *
 * Required env:
 *   STAGING_API_URL          e.g. https://staging-api.ventechgadgets.com
 *   PAYSTACK_SECRET_KEY      staging secret (signs the webhook)
 *   PAYSTACK_TEST_REFERENCE  a Paystack test reference that already paid
 *
 * Optional:
 *   REGULAR_PRODUCT_ID
 *   PREORDER_PRODUCT_ID
 */
import crypto from 'crypto';

const api = (process.env.STAGING_API_URL || '').replace(/\/$/, '');
const secret = process.env.PAYSTACK_SECRET_KEY || '';
const reference = process.env.PAYSTACK_TEST_REFERENCE || '';
const regularProductId = process.env.REGULAR_PRODUCT_ID || '';
const preorderProductId = process.env.PREORDER_PRODUCT_ID || '';

if (!api || !secret || !reference) {
  console.error('Set STAGING_API_URL, PAYSTACK_SECRET_KEY, and PAYSTACK_TEST_REFERENCE.');
  process.exit(1);
}

if (/ventechgadgets\.com$/i.test(new URL(api).host) && !/staging/i.test(api)) {
  console.error('Refusing to run against a host that is not staging.');
  process.exit(1);
}

const checkout_data = {
  customer_bio: { name: 'Race Test', email: 'race@example.test', phone: '0200000000' },
  delivery_address: {
    recipient_name: 'Race Test',
    phone: '0200000000',
    email: 'race@example.test',
    address: 'Accra',
  },
  delivery_option: { id: process.env.DELIVERY_OPTION_ID || 'delivery-accra', name: 'Accra' },
  regularItems: regularProductId
    ? [{ product_id: regularProductId, quantity: 1, selected_variants: {} }]
    : [],
  preOrderItems: preorderProductId
    ? [{ product_id: preorderProductId, quantity: 1, selected_variants: {}, is_pre_order: true }]
    : [],
  pre_order_shipping_option: preorderProductId ? 'air_cargo' : undefined,
};

function orderBody(isPreOrder: boolean) {
  const items = isPreOrder ? checkout_data.preOrderItems : checkout_data.regularItems;
  return {
    payment_method: 'paystack',
    payment_reference: reference,
    delivery_address: checkout_data.delivery_address,
    customer_bio: checkout_data.customer_bio,
    order_items: items,
    delivery_option: isPreOrder ? undefined : checkout_data.delivery_option,
    is_pre_order: isPreOrder,
    pre_order_shipping_option: isPreOrder ? 'air_cargo' : undefined,
  };
}

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  const raw = JSON.stringify(body);
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw,
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function postWebhook() {
  const event = {
    event: 'charge.success',
    data: {
      reference,
      status: 'success',
      metadata: { checkout_data, payment_reference: reference },
    },
  };
  const raw = JSON.stringify(event);
  const signature = crypto.createHmac('sha512', secret).update(raw).digest('hex');
  const response = await fetch(`${api}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-paystack-signature': signature,
    },
    body: raw,
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function main() {
  const jobs: Array<Promise<{ label: string; status: number; text: string }>> = [];
  if (regularProductId) {
    jobs.push(
      postJson('/api/orders', orderBody(false)).then((row) => ({ label: 'callback-regular', ...row }))
    );
  }
  if (preorderProductId) {
    jobs.push(
      postJson('/api/orders', orderBody(true)).then((row) => ({ label: 'callback-preorder', ...row }))
    );
  }
  jobs.push(postWebhook().then((row) => ({ label: 'webhook', ...row })));

  const results = await Promise.all(jobs);
  for (const row of results) {
    console.log(row.label, row.status, row.text.slice(0, 500));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
