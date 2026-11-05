export function buildMixedCheckoutMetadata(itemCount = 50): {
  user_id: string;
  payment_reference: string;
  checkout_data: Record<string, unknown>;
} {
  const longName =
    'MacBook Pro 16-inch M3 Max Space Black 48GB Unified Memory 1TB SSD Laptop';
  const variants = {
    ram: {
      id: 'opt-ram-48gb-unified-memory',
      name: 'Memory',
      value: '48GB unified memory extra-long storefront label',
    },
    storage: {
      id: 'opt-ssd-1tb-nvme',
      name: 'Storage',
      value: '1TB SSD extra-long storefront label',
    },
    colour: {
      id: 'opt-space-black',
      name: 'Colour',
      value: 'Space Black extra-long storefront label',
    },
  };

  const regularItems: Record<string, unknown>[] = [];
  const preOrderItems: Record<string, unknown>[] = [];
  for (let i = 0; i < itemCount; i += 1) {
    const item = {
      id: `11111111-1111-1111-1111-${String(i).padStart(12, '0')}`,
      product_id: `11111111-1111-1111-1111-${String(i).padStart(12, '0')}`,
      name: `${longName} edition ${i + 1}`,
      thumbnail: 'https://cdn.example.test/media/laptops/macbook-pro-16-space-black-hero-large.jpg',
      image_url: 'https://cdn.example.test/media/laptops/macbook-pro-16-space-black-hero-large.jpg',
      quantity: 1,
      discount_price: 19999.99,
      original_price: 24999.99,
      subtotal: 19999.99,
      selected_variants: variants,
      is_pre_order: i % 2 === 1,
    };
    if (i % 2 === 1) preOrderItems.push({ ...item, pre_order_shipping_option: 'air_cargo' });
    else regularItems.push(item);
  }

  const checkout_data = {
    customer_bio: {
      name: 'Kwame Mensah',
      email: 'kwame.mensah@example.test',
      phone: '0244111222',
    },
    delivery_address: {
      recipient_name: 'Kwame Mensah',
      phone: '0244111222',
      email: 'kwame.mensah@example.test',
      address: 'House 12, Long Street Name That Is Unreasonably Descriptive, East Legon',
      city: 'Accra',
      region: 'Greater Accra',
      notes: 'Please call on arrival. '.repeat(20),
    },
    delivery_option: { id: 'delivery-accra', name: 'Accra same-day', price: 50 },
    pre_order_shipping_option: 'air_cargo',
    estimated_arrival_date: '2026-12-15T00:00:00.000Z',
    notes: 'Gift wrap and include the warranty card. '.repeat(15),
    coupon_id: null,
    referral: { click_id: '22222222-2222-2222-2222-222222222222' },
    regularItems,
    preOrderItems,
  };

  return {
    user_id: 'guest',
    payment_reference: 'TEST_REF_50_ITEM_CART',
    checkout_data,
  };
}

export function checkoutMetadataSizeKb(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8') / 1024;
}
