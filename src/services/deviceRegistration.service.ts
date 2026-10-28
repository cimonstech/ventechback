import { supabaseAdmin } from '../utils/supabaseClient';
import { logAudit, type AuditEntry } from './audit.service';
import { generateQrToken } from './device.service';
import { settingsService } from './settings.service';

type AuditReq = AuditEntry['req'];

const SETTING_KEY = 'device_registration_category_slugs';
const DEFAULT_SLUGS = ['laptops'];

function logDb(scope: string, error: unknown) {
  console.error(scope, error);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function textField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return isIsoDate(date) ? date : null;
}

function asSlugs(value: string | null | undefined): string[] {
  if (!value || !value.trim()) return [...DEFAULT_SLUGS];
  const parts = value.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
  return parts.length ? parts : [...DEFAULT_SLUGS];
}

export async function registrationCategoryIds(): Promise<Set<string>> {
  const raw = await settingsService.getSetting(SETTING_KEY);
  const wanted = new Set(asSlugs(raw));
  if (wanted.size === 0) return new Set();

  const { data, error } = await supabaseAdmin.from('categories').select('id, slug, parent_id');
  if (error) {
    logDb('load categories for device registration', error);
    throw error;
  }

  const all = data || [];
  const ids = new Set(all.filter((row) => wanted.has(String(row.slug || '').toLowerCase())).map((row) => row.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of all) {
      if (row.parent_id && ids.has(row.parent_id) && !ids.has(row.id)) {
        ids.add(row.id);
        grew = true;
      }
    }
  }
  return ids;
}

function customerFromOrder(
  order: { user_id: string | null; customer_bio: unknown; shipping_address: unknown },
  account: { full_name?: string | null; email?: string | null; phone?: string | null } | null
) {
  const bio = record(order.customer_bio);
  const shipping = record(order.shipping_address);
  return {
    user_id: order.user_id,
    customer_name:
      textField(bio.name) ||
      textField(account?.full_name) ||
      textField(shipping.recipient_name) ||
      textField(shipping.full_name),
    customer_email: textField(bio.email) || textField(account?.email) || textField(shipping.email),
    customer_phone:
      textField(bio.phone) ||
      textField(account?.phone) ||
      textField(shipping.phone) ||
      textField(shipping.recipient_number),
  };
}

export async function createPendingDevicesForOrder(orderId: string): Promise<number> {
  const categoryIds = await registrationCategoryIds();
  if (categoryIds.size === 0) return 0;

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, customer_bio, shipping_address, created_at')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) {
    logDb('create pending devices order', orderError);
    throw orderError;
  }
  if (!order) return 0;

  const purchaseDate = dateOnly(order.created_at);
  if (!purchaseDate) return 0;

  const { data: items, error: itemError } = await supabaseAdmin
    .from('order_items')
    .select(`
      id, product_id, product_name, quantity,
      product:products!order_items_product_id_fkey ( id, name, warranty_months, category_id )
    `)
    .eq('order_id', orderId);
  if (itemError) {
    logDb('create pending devices items', itemError);
    throw itemError;
  }

  const eligible = (items || []).filter((item) => {
    const product = one(item.product as { category_id?: string | null } | { category_id?: string | null }[] | null);
    return Boolean(product?.category_id && categoryIds.has(product.category_id));
  });
  if (eligible.length === 0) return 0;

  let account: { full_name?: string | null; email?: string | null; phone?: string | null } | null = null;
  if (order.user_id) {
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('full_name, email, phone')
      .eq('id', order.user_id)
      .maybeSingle();
    if (userError) {
      logDb('create pending devices user', userError);
      throw userError;
    }
    account = user;
  }

  const customer = customerFromOrder(order, account);
  const itemIds = eligible.map((item) => item.id);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('devices')
    .select('order_item_id, unit_no')
    .in('order_item_id', itemIds);
  if (existingError) {
    logDb('create pending devices existing', existingError);
    throw existingError;
  }

  const taken = new Set(
    (existing || [])
      .filter((row) => row.order_item_id && row.unit_no != null)
      .map((row) => `${row.order_item_id}:${row.unit_no}`)
  );

  const rows = [];
  for (const item of eligible) {
    const product = one(item.product as { id?: string; name?: string; warranty_months?: number | null } | null);
    const modelName = product?.name || item.product_name;
    if (!modelName) continue;
    const quantity = Math.min(100, Math.max(0, Math.floor(Number(item.quantity) || 0)));
    const warrantyMonths = Number.isInteger(product?.warranty_months)
      ? Number(product?.warranty_months)
      : 0;
    for (let unitNo = 1; unitNo <= quantity; unitNo += 1) {
      if (taken.has(`${item.id}:${unitNo}`)) continue;
      rows.push({
        order_id: order.id,
        order_item_id: item.id,
        product_id: product?.id || item.product_id,
        user_id: order.user_id,
        customer_name: customer.customer_name,
        customer_email: customer.customer_email,
        customer_phone: customer.customer_phone,
        model_name: modelName,
        serial_number: null,
        unit_no: unitNo,
        purchase_date: purchaseDate,
        warranty_months: warrantyMonths,
        warranty_start: purchaseDate,
        qr_token: generateQrToken(),
        status: 'pending',
        owner_linked_at: order.user_id ? new Date().toISOString() : null,
      });
    }
  }

  if (rows.length === 0) return 0;

  const { error: insertError } = await supabaseAdmin.from('devices').insert(rows);
  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') {
      return 0;
    }
    logDb('create pending devices insert', insertError);
    throw insertError;
  }
  return rows.length;
}

export async function tryCreatePendingDevicesForOrder(orderId: string | null | undefined): Promise<void> {
  if (!orderId) return;
  try {
    await createPendingDevicesForOrder(orderId);
  } catch (error) {
    console.error('create pending devices for order failed', orderId, error);
  }
}

function retireNote(existing: string | null | undefined, reason: 'cancelled' | 'refunded'): string {
  const line = reason === 'refunded'
    ? 'Retired because the order was refunded.'
    : 'Retired because the order was cancelled.';
  const previous = (existing || '').trim();
  return previous ? `${previous}\n${line}` : line;
}

export async function handleOrderCancelledOrRefunded(
  req: AuditReq,
  orderId: string,
  reason: 'cancelled' | 'refunded'
): Promise<void> {
  const { data: devices, error } = await supabaseAdmin
    .from('devices')
    .select('id, status, notes, serial_number, user_id')
    .eq('order_id', orderId);
  if (error) {
    logDb('load devices for order cancel/refund', error);
    throw error;
  }
  if (!devices || devices.length === 0) return;

  const pendingIds = devices.filter((row) => row.status === 'pending').map((row) => row.id);
  const activeIds = devices.filter((row) => row.status === 'active').map((row) => row.id);

  if (pendingIds.length) {
    const pending = devices.filter((row) => pendingIds.includes(row.id));
    const { error: deleteError } = await supabaseAdmin.from('devices').delete().in('id', pendingIds);
    if (deleteError) {
      logDb('delete pending devices for order', deleteError);
      throw deleteError;
    }
    for (const row of pending) {
      await logAudit({
        req,
        entity: 'device',
        entityId: row.id,
        action: reason === 'refunded' ? 'refund-delete' : 'cancel-delete',
        before: { id: row.id, status: row.status, serial_number: row.serial_number, user_id: row.user_id },
        after: null,
      });
    }
  }

  if (activeIds.length) {
    const actives = devices.filter((row) => activeIds.includes(row.id));
    for (const row of actives) {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('devices')
        .update({
          status: 'retired',
          notes: retireNote(row.notes, reason),
        })
        .eq('id', row.id)
        .eq('status', 'active')
        .select('id, status, notes')
        .maybeSingle();
      if (updateError) {
        logDb('retire device for order', updateError);
        throw updateError;
      }
      if (!updated) continue;
      await logAudit({
        req,
        entity: 'device',
        entityId: row.id,
        action: reason === 'refunded' ? 'refund-retire' : 'cancel-retire',
        before: { id: row.id, status: row.status, notes: row.notes },
        after: { id: updated.id, status: updated.status, notes: updated.notes },
      });
    }
  }
}

export async function tryHandleOrderCancelledOrRefunded(
  req: AuditReq,
  orderId: string | null | undefined,
  reason: 'cancelled' | 'refunded'
): Promise<void> {
  if (!orderId) return;
  try {
    await handleOrderCancelledOrRefunded(req, orderId, reason);
  } catch (error) {
    console.error('handle devices for cancelled/refunded order failed', orderId, error);
  }
}

export async function linkPendingDevicesForVerifiedUser(
  req: AuditReq,
  userId: string
): Promise<number> {
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authError) {
    logDb('link devices auth user', authError);
    throw authError;
  }
  const email = (authData?.user?.email || '').trim().toLowerCase();
  if (!email || !authData.user?.email_confirmed_at) return 0;

  const { data: devices, error } = await supabaseAdmin
    .from('devices')
    .select('id, user_id, customer_email, status')
    .is('user_id', null);
  if (error) {
    logDb('link devices lookup', error);
    throw error;
  }

  const matches = (devices || []).filter(
    (row) => (row.customer_email || '').trim().toLowerCase() === email
  );
  if (matches.length === 0) return 0;

  const linkedAt = new Date().toISOString();
  let linked = 0;
  for (const row of matches) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('devices')
      .update({ user_id: userId, owner_linked_at: linkedAt })
      .eq('id', row.id)
      .is('user_id', null)
      .select('id, user_id')
      .maybeSingle();
    if (updateError) {
      logDb('link devices update', updateError);
      continue;
    }
    if (!updated) continue;
    linked += 1;
    await logAudit({
      req,
      entity: 'device',
      entityId: row.id,
      action: 'auto_link',
      before: { user_id: null, customer_email: row.customer_email, status: row.status },
      after: { user_id: userId, customer_email: row.customer_email, status: row.status },
    });
  }
  return linked;
}

export async function countLaptopProductsWithoutWarranty(): Promise<{ count: number; ids: string[] }> {
  const categoryIds = await registrationCategoryIds();
  if (categoryIds.size === 0) return { count: 0, ids: [] };

  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id, category_id, warranty_months')
    .in('category_id', [...categoryIds])
    .is('warranty_months', null);
  if (error) {
    logDb('laptop products without warranty', error);
    throw error;
  }
  const ids = (data || []).map((row) => row.id);
  return { count: ids.length, ids };
}

export async function orderDeviceStatus(orderId: string): Promise<{
  laptop_units: number;
  active_devices: number;
  pending_devices: number;
  missing_serials: number;
  order_number: string | null;
} | null> {
  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, order_number')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) {
    logDb('order device status order', orderError);
    throw orderError;
  }
  if (!order) return null;

  const categoryIds = await registrationCategoryIds();
  const { data: items, error: itemError } = await supabaseAdmin
    .from('order_items')
    .select(`
      id, quantity,
      product:products!order_items_product_id_fkey ( category_id )
    `)
    .eq('order_id', orderId);
  if (itemError) {
    logDb('order device status items', itemError);
    throw itemError;
  }

  let laptopUnits = 0;
  const laptopItemIds: string[] = [];
  for (const item of items || []) {
    const product = one(item.product as { category_id?: string | null } | null);
    if (!product?.category_id || !categoryIds.has(product.category_id)) continue;
    laptopUnits += Math.max(0, Math.floor(Number(item.quantity) || 0));
    laptopItemIds.push(item.id);
  }

  let activeDevices = 0;
  let pendingDevices = 0;
  if (laptopItemIds.length) {
    const { data: devices, error: deviceError } = await supabaseAdmin
      .from('devices')
      .select('id, status, serial_number, order_item_id')
      .eq('order_id', orderId)
      .in('order_item_id', laptopItemIds);
    if (deviceError) {
      logDb('order device status devices', deviceError);
      throw deviceError;
    }
    for (const row of devices || []) {
      if (row.status === 'pending') pendingDevices += 1;
      else if (row.status === 'active' || row.status === 'transferred') activeDevices += 1;
    }
  }

  const missingSerials = Math.max(0, laptopUnits - activeDevices);
  return {
    laptop_units: laptopUnits,
    active_devices: activeDevices,
    pending_devices: pendingDevices,
    missing_serials: missingSerials,
    order_number: order.order_number ?? null,
  };
}
