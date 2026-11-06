import {
  enumLabel,
  formatDateAccra,
  formatMoneyGhs,
} from './copy';
import type { EmailDetailRow, EmailLineItem } from './types';

export type OrderEmailInput = {
  id?: string;
  order_number?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  created_at?: string;
  total?: number;
  subtotal?: number;
  discount?: number;
  tax?: number;
  shipping_fee?: number;
  delivery_fee?: number;
  payment_method?: string;
  payment_status?: string;
  status?: string;
  is_pre_order?: boolean;
  pre_order_shipping_option?: string;
  estimated_arrival_date?: string;
  notes?: string;
  cancellation_reason?: string;
  items?: Array<Record<string, unknown>>;
  delivery_address?: Record<string, unknown> | string | null;
  shipping_address?: Record<string, unknown> | string | null;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

export function orderNumberOf(order: OrderEmailInput): string {
  return str(order.order_number) || 'your order';
}

export function isPreOrder(order: OrderEmailInput): boolean {
  return Boolean(order.is_pre_order);
}

export function orderItems(order: OrderEmailInput): EmailLineItem[] {
  return (order.items || []).map((item) => {
    const quantity = num(item.quantity) || 1;
    const unitPrice = num(item.unit_price ?? item.price ?? item.discount_price);
    const lineTotal = item.subtotal != null ? num(item.subtotal) : unitPrice * quantity;
    return {
      name: str(item.product_name ?? item.name ?? item.gadget_name) || 'Item',
      quantity,
      unitPrice,
      lineTotal,
    };
  });
}

function addressObject(order: OrderEmailInput): Record<string, unknown> {
  const a = order.delivery_address || order.shipping_address;
  if (!a || typeof a === 'string') return {};
  return a;
}

export function deliveryRows(order: OrderEmailInput): EmailDetailRow[] {
  const addr = addressObject(order);
  const recipient =
    str(addr.recipient_name) || str(addr.full_name) || str(order.customer_name);
  const phone =
    str(addr.recipient_number) || str(addr.phone) || str(order.customer_phone);
  const location =
    str(addr.recipient_location) ||
    str(addr.location) ||
    str(addr.street_address) ||
    str(addr.street);
  const region = str(addr.recipient_region) || str(addr.region) || str(addr.city);
  const country = str(addr.country) || 'Ghana';
  const gadget = str(addr.gadget_name);
  const alternate = str(addr.alternate_contact_number);
  const rows: EmailDetailRow[] = [];
  if (gadget) rows.push({ label: 'Gadget name', value: gadget });
  if (recipient) rows.push({ label: 'Recipient', value: recipient });
  if (phone) rows.push({ label: 'Phone', value: phone });
  if (alternate) rows.push({ label: 'Alternate phone', value: alternate });
  if (location) rows.push({ label: 'Location', value: location });
  if (region) rows.push({ label: 'Region', value: region });
  if (country) rows.push({ label: 'Country', value: country });
  return rows;
}

export function moneyRows(order: OrderEmailInput): EmailDetailRow[] {
  const items = orderItems(order);
  const subtotal =
    order.subtotal != null
      ? num(order.subtotal)
      : items.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
  const shipping = num(order.shipping_fee ?? order.delivery_fee);
  const discount = num(order.discount);
  const tax = num(order.tax);
  const total = order.total != null ? num(order.total) : subtotal + shipping + tax - discount;
  const shippingLabel = isPreOrder(order) ? 'Shipment' : 'Delivery';
  const rows: EmailDetailRow[] = [{ label: 'Subtotal', value: formatMoneyGhs(subtotal) }];
  if (discount) rows.push({ label: 'Discount', value: `\u2212${formatMoneyGhs(discount)}` });
  if (tax) rows.push({ label: 'Tax', value: formatMoneyGhs(tax) });
  rows.push({ label: shippingLabel, value: formatMoneyGhs(shipping) });
  rows.push({ label: 'Total', value: formatMoneyGhs(total) });
  return rows;
}

export function paymentMethodLabel(order: OrderEmailInput): string {
  return enumLabel(str(order.payment_method) || 'paystack') || 'Paystack';
}

export function shippingMethodLabel(order: OrderEmailInput): string {
  return enumLabel(order.pre_order_shipping_option);
}

export function preOrderDetailRows(order: OrderEmailInput): EmailDetailRow[] {
  if (!isPreOrder(order)) return [];
  const rows: EmailDetailRow[] = [];
  const method = shippingMethodLabel(order);
  if (method) rows.push({ label: 'Shipping method', value: method });
  const arrival = formatDateAccra(order.estimated_arrival_date);
  if (arrival) rows.push({ label: 'Estimated arrival', value: arrival });
  return rows;
}

export function orderStatusHeading(status: string, preOrder: boolean): string {
  const kind = preOrder ? 'pre-order' : 'order';
  const key = String(status || '').toLowerCase();
  if (key === 'processing') return `Your ${kind} is being processed`;
  if (key === 'shipped') return `Your ${kind} is on the way`;
  if (key === 'delivered') return `Your ${kind} has been delivered`;
  if (key === 'cancelled') return `Your ${kind} has been cancelled`;
  if (key === 'pending') return `Your ${kind} is pending`;
  if (key === 'confirmed') return `Your ${kind} is confirmed`;
  const label = enumLabel(status).toLowerCase() || 'updated';
  return `Your ${kind} is now ${label}`;
}

export function orderStatusSubject(orderNumber: string, status: string, preOrder: boolean): string {
  const key = String(status || '').toLowerCase();
  if (key === 'processing' && preOrder) return `Your pre-order ${orderNumber} is being processed`;
  if (key === 'processing') return `Your order ${orderNumber} is being processed`;
  if (key === 'shipped') return `Order ${orderNumber} is on the way`;
  if (key === 'delivered') return `Order ${orderNumber} has been delivered`;
  if (key === 'cancelled') return `Order ${orderNumber} has been cancelled`;
  if (key === 'confirmed') return `Order ${orderNumber} confirmed`;
  return `Order ${orderNumber} is now ${enumLabel(status).toLowerCase()}`;
}

export function orderStatusNextSteps(status: string, preOrder: boolean): string[] {
  const key = String(status || '').toLowerCase();
  if (key === 'processing' && preOrder) {
    return [
      'We source and pack your item.',
      'It ships using the method on this order.',
      'We email you again when it is on the way.',
    ];
  }
  if (key === 'processing') {
    return [
      'We pack your order.',
      'We hand it to the delivery partner.',
      'You can follow it from your account.',
    ];
  }
  if (key === 'shipped') {
    return ['Keep your phone nearby for the rider.', 'Check your account if you need the latest status.'];
  }
  if (key === 'delivered') {
    return ['Inspect the item when you receive it.', 'Write to support if anything is missing or damaged.'];
  }
  if (key === 'cancelled') {
    return ['If you paid online, any refund follows your original payment method.', 'Place a new order whenever you are ready.'];
  }
  return ['Open your order for the latest details.'];
}

export function statusTone(status: string): 'success' | 'warning' | 'error' | 'info' {
  const key = String(status || '').toLowerCase();
  if (['delivered', 'paid', 'completed', 'active', 'approved', 'ready'].includes(key)) return 'success';
  if (['cancelled', 'failed', 'rejected', 'reversed', 'closed'].includes(key)) return 'error';
  if (['processing', 'shipped', 'pending', 'under_review', 'diagnosing'].includes(key)) return 'warning';
  return 'info';
}
