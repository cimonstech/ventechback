import axios from 'axios';
import { supabaseAdmin } from '../utils/supabaseClient';

// Server-side copy of the storefront's price rules. Prices, delivery and
// discounts sent by the browser are never trusted.
const FREE_DELIVERY_THRESHOLD = 20000;
const PRE_ORDER_SHIPPING_PRICES: Record<string, number> = {
  air_cargo: 400,
  ship_cargo: 200,
};
const DEFAULT_PRE_ORDER_SHIPPING = 'air_cargo';
const MAX_QUANTITY_PER_ITEM = 100;
const PAYMENT_REFERENCE_PATTERN = /^[A-Za-z0-9_.=-]{6,100}$/;

export class PricingError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode = 400,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

interface RequestedItem {
  product_id: string;
  quantity: number;
  selected_variants?: Record<string, any> | null;
}

interface PricedItem {
  product_id: string;
  product_name: string;
  product_image: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  selected_variants: Record<string, any>;
}

interface PricedOrder {
  items: PricedItem[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  couponId: string | null;
  tax: number;
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const isValidPaymentReference = (reference: unknown): reference is string =>
  typeof reference === 'string' && PAYMENT_REFERENCE_PATTERN.test(reference);

export async function priceOrder(input: {
  items: RequestedItem[];
  isPreOrder: boolean;
  deliveryOptionId?: string | null;
  preOrderShippingOption?: string | null;
  couponId?: string | null;
  userId: string | null;
}): Promise<PricedOrder> {
  const { items, isPreOrder, userId } = input;

  for (const item of items) {
    if (!item?.product_id || typeof item.product_id !== 'string') {
      throw new PricingError('Some order items have invalid product IDs', 'INVALID_PRODUCT_IDS');
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_ITEM) {
      throw new PricingError(`Invalid quantity for product ${item.product_id}`, 'INVALID_QUANTITY');
    }
  }

  const productIds = [...new Set(items.map((item) => item.product_id))];
  const { data: products, error: productsError } = await supabaseAdmin
    .from('products')
    .select('id, name, price, discount_price, thumbnail, images')
    .in('id', productIds);
  if (productsError) throw productsError;

  const productsById = new Map((products || []).map((p: any) => [p.id, p]));
  const missingProductIds = productIds.filter((id) => !productsById.has(id));
  if (missingProductIds.length > 0) {
    throw new PricingError(
      `Products not found: ${missingProductIds.join(', ')}. These products may have been removed from the catalog.`,
      'PRODUCTS_NOT_FOUND',
      400,
      { missingProductIds }
    );
  }

  // Real variant options must be linked to the product. The storefront also
  // adds placeholder "default-<attributeId>" options that cost nothing.
  const optionIds = new Set<string>();
  for (const item of items) {
    for (const variant of Object.values(item.selected_variants || {})) {
      const id = variant?.id;
      if (typeof id === 'string' && !id.startsWith('default-')) optionIds.add(id);
    }
  }

  const linkedOptions = new Set<string>();
  const optionsById = new Map<string, any>();
  if (optionIds.size > 0) {
    const [{ data: links, error: linksError }, { data: options, error: optionsError }] = await Promise.all([
      supabaseAdmin
        .from('product_selected_options')
        .select('product_id, option_id')
        .in('product_id', productIds),
      supabaseAdmin
        .from('product_attribute_options')
        .select('id, attribute_id, label, value, price_modifier, is_available')
        .in('id', [...optionIds]),
    ]);
    if (linksError) throw linksError;
    if (optionsError) throw optionsError;
    (links || []).forEach((l: any) => linkedOptions.add(`${l.product_id}:${l.option_id}`));
    (options || []).forEach((o: any) => optionsById.set(o.id, o));
  }

  const pricedItems: PricedItem[] = items.map((item) => {
    const product: any = productsById.get(item.product_id);
    const selectedVariants: Record<string, any> = {};
    let modifiers = 0;

    for (const [key, variant] of Object.entries(item.selected_variants || {})) {
      const id = variant?.id;
      if (typeof id !== 'string') {
        throw new PricingError(`Invalid option selected for ${product.name}`, 'INVALID_VARIANT');
      }

      if (id.startsWith('default-')) {
        selectedVariants[key] = { id, name: variant.name || 'Default', value: 'default', price_adjustment: 0 };
        continue;
      }

      const option = optionsById.get(id);
      if (!option || !linkedOptions.has(`${product.id}:${id}`) || option.is_available === false) {
        throw new PricingError(
          `An option you selected for ${product.name} is no longer available. Please update your cart.`,
          'VARIANT_UNAVAILABLE'
        );
      }

      const priceAdjustment = Number(option.price_modifier) || 0;
      modifiers += priceAdjustment;
      selectedVariants[option.attribute_id] = {
        id: option.id,
        name: option.label,
        value: option.value,
        price_adjustment: priceAdjustment,
      };
    }

    const basePrice = Number(product.discount_price) || Number(product.price) || 0;
    const unitPrice = round2(basePrice + modifiers);
    if (unitPrice <= 0) {
      throw new PricingError(`${product.name} has no valid price`, 'INVALID_PRICE');
    }

    return {
      product_id: product.id,
      product_name: product.name,
      product_image: product.thumbnail || product.images?.[0] || '',
      quantity: item.quantity,
      unit_price: unitPrice,
      total_price: round2(unitPrice * item.quantity),
      selected_variants: selectedVariants,
    };
  });

  const subtotal = round2(pricedItems.reduce((sum, item) => sum + item.total_price, 0));

  let deliveryFee = 0;
  if (isPreOrder) {
    deliveryFee =
      PRE_ORDER_SHIPPING_PRICES[input.preOrderShippingOption || ''] ??
      PRE_ORDER_SHIPPING_PRICES[DEFAULT_PRE_ORDER_SHIPPING];
  } else if (subtotal < FREE_DELIVERY_THRESHOLD) {
    const { data: deliveryOptions, error: deliveryError } = await supabaseAdmin
      .from('delivery_options')
      .select('id, price')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (deliveryError) throw deliveryError;

    const chosen =
      (deliveryOptions || []).find((o: any) => o.id === input.deliveryOptionId) ||
      (deliveryOptions || [])[0];
    deliveryFee = Number(chosen?.price) || 0;
  }

  let discount = 0;
  let couponId: string | null = null;
  if (input.couponId) {
    const { data: coupon } = await supabaseAdmin
      .from('coupons')
      .select('id, code')
      .eq('id', input.couponId)
      .maybeSingle();

    if (!coupon) {
      throw new PricingError(
        'That coupon is no longer available. Remove it and review your total.',
        'COUPON_INVALID'
      );
    }

    const { data: validation, error: couponError } = await supabaseAdmin.rpc('validate_coupon', {
      coupon_code: coupon.code,
      cart_amount: subtotal,
      user_id_param: userId,
    });
    if (couponError) throw couponError;
    if (!validation?.is_valid) {
      throw new PricingError(
        validation?.error_message || 'This coupon does not apply to the current cart.',
        'COUPON_INVALID'
      );
    }

    discount = round2(Math.min(Number(validation.discount_amount) || 0, subtotal));
    couponId = coupon.id;
  }

  const tax = 0;
  const total = round2(Math.max(subtotal + deliveryFee + tax - discount, 0));

  return { items: pricedItems, subtotal, deliveryFee, discount, couponId, tax, total };
}

// Confirms a payment with Paystack itself and returns the amount paid in GHS.
export async function verifyPaystackPayment(reference: string): Promise<{ amountGhs: number; raw: any }> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    throw new PricingError('Payment verification is not configured', 'PAYSTACK_NOT_CONFIGURED', 500);
  }

  let transaction: any;
  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` }, timeout: 15000 }
    );
    transaction = response.data?.data;
  } catch (error: any) {
    console.error('Paystack verification request failed:', error?.response?.data || error?.message);
    throw new PricingError('Could not verify payment with Paystack', 'PAYMENT_VERIFICATION_FAILED', 402);
  }

  if (transaction?.status !== 'success' || transaction?.currency !== 'GHS') {
    throw new PricingError('Payment was not successful', 'PAYMENT_NOT_SUCCESSFUL', 402);
  }

  return { amountGhs: round2(Number(transaction.amount) / 100), raw: transaction };
}
