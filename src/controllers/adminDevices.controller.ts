import { Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../utils/supabaseClient';
import { AuthRequest } from '../middleware/auth.middleware';
import { errorResponse, paginatedResponse, successResponse } from '../utils/responseHandlers';
import { logAudit } from '../services/audit.service';
import { generateQrToken, ownerDisplayName, sendDeviceRegistrationEmail, sendOwnerLinkedEmail, warrantyStatus } from '../services/device.service';
import {
  countLaptopProductsWithoutOs,
  countLaptopProductsWithoutWarranty,
  orderDeviceStatus,
} from '../services/deviceRegistration.service';
import { portalEventStats } from '../services/portalEvents.service';

const DEVICE_STATUSES = ['pending', 'active', 'transferred', 'retired'] as const;
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createSchema = z.object({
  order_id: z.uuid(),
  items: z.array(z.object({
    order_item_id: z.uuid(),
    product_id: z.uuid(),
    serial_number: z.string().trim().min(1).max(200),
    warranty_months: z.number().int().min(0).max(120).nullish(),
    purchase_date: dateSchema.nullish(),
    device_id: z.uuid().optional(),
  })).min(1).max(100),
});

const updateSchema = z.object({
  serial_number: z.string().trim().min(1).max(200).optional(),
  warranty_months: z.number().int().min(0).max(120).optional(),
  warranty_start: dateSchema.optional(),
  warranty_start_reason: z.string().trim().min(1).max(500).optional(),
  notes: z.string().max(5000).nullable().optional(),
  status: z.enum(['active', 'transferred', 'retired']).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

const linkSchema = z.object({
  email: z.string().trim().email(),
});

const LIST_SELECT = `
  id, order_id, order_item_id, product_id, user_id,
  customer_name, customer_email, customer_phone,
  model_name, serial_number, unit_no, purchase_date,
  warranty_months, warranty_start, qr_token, status, notes,
  owner_linked_at,
  created_by, updated_by, created_at, updated_at,
  product:products!devices_product_id_fkey(id, name, slug, thumbnail, warranty_months),
  order:orders!devices_order_id_fkey(id, order_number, user_id)
`;

const DETAIL_SELECT = `
  ${LIST_SELECT},
  owner:users!devices_user_id_fkey(id, full_name, first_name, last_name, email, phone)
`;

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function queryValue(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

function logDb(scope: string, error: unknown) {
  console.error(scope, error);
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown, res: Response, message: string): T | undefined {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    errorResponse(res, message, 400, parsed.error.flatten());
    return undefined;
  }
  return parsed.data;
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

async function countPendingDevices(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('devices')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) {
    logDb('count pending devices', error);
    return 0;
  }
  return count || 0;
}

function searchTerm(raw: string): string {
  return raw.replace(/[%_\\",()]/g, '').trim().slice(0, 80);
}

function dbCode(error: unknown): { code: string; details: string } {
  const row = error as { code?: string; details?: string };
  return { code: row?.code || '', details: row?.details || '' };
}

function serialFromUniqueError(details: string, serials: string[]): string | null {
  const match = details.match(/\(lower\(serial_number\)\)=\(([^)]+)\)/i);
  if (!match) return serials.length === 1 ? serials[0] : null;
  return serials.find((serial) => serial.toLowerCase() === match[1].toLowerCase()) || match[1];
}

function auditDevice(row: Record<string, any> | null) {
  if (!row) return null;
  return {
    id: row.id,
    order_id: row.order_id ?? null,
    order_item_id: row.order_item_id ?? null,
    product_id: row.product_id ?? null,
    user_id: row.user_id ?? null,
    customer_name: row.customer_name ?? null,
    model_name: row.model_name ?? null,
    serial_number: row.serial_number ?? null,
    purchase_date: row.purchase_date ?? null,
    warranty_months: row.warranty_months ?? null,
    warranty_start: row.warranty_start ?? null,
    status: row.status ?? null,
    notes: row.notes ?? null,
    owner_linked_at: row.owner_linked_at ?? null,
  };
}

async function presentDevice(row: Record<string, any>) {
  const product = one(row.product);
  const order = one(row.order);
  const owner = one(row.owner);
  const {
    product: _product,
    order: _order,
    owner: _owner,
    ...device
  } = row;

  const ownerName = owner
    ? await ownerDisplayName(owner, { maskEmail: false })
    : '';

  return {
    ...device,
    warranty: warrantyStatus(device),
    order_number: order?.order_number ?? null,
    product: product
      ? {
          id: product.id,
          name: product.name,
          slug: product.slug ?? null,
          thumbnail: product.thumbnail ?? null,
          warranty_months: product.warranty_months ?? null,
        }
      : null,
    order: order ? { id: order.id, order_number: order.order_number, user_id: order.user_id ?? null } : null,
    owner: owner
      ? {
          id: owner.id,
          full_name: ownerName || null,
          email: owner.email ?? null,
          phone: owner.phone ?? null,
        }
      : null,
  };
}

async function findSerialOwner(serial: string, exceptId?: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('devices')
    .select('id, serial_number')
    .ilike('serial_number', serial);

  if (error) throw error;

  const match = (data || []).find((row) => {
    if (exceptId && row.id === exceptId) return false;
    return String(row.serial_number).toLowerCase() === serial.toLowerCase();
  });
  return match ? String(match.serial_number) : null;
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

export async function listDevices(req: AuthRequest, res: Response) {
  try {
    const page = Math.max(1, parseInt(queryValue(req.query.page) || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(queryValue(req.query.limit) || '20', 10) || 20));
    const status = queryValue(req.query.status);
    const warranty = queryValue(req.query.warranty);
    const term = searchTerm(queryValue(req.query.search));

    if (status && !DEVICE_STATUSES.includes(status as (typeof DEVICE_STATUSES)[number])) {
      return errorResponse(res, 'Status must be pending, active, transferred, or retired.', 400);
    }
    if (warranty && warranty !== 'active' && warranty !== 'expired') {
      return errorResponse(res, 'Warranty filter must be active or expired.', 400);
    }

    let orderIds: string[] = [];
    if (term) {
      const { data: orders, error: orderError } = await supabaseAdmin
        .from('orders')
        .select('id')
        .ilike('order_number', `%${term}%`)
        .limit(100);
      if (orderError) {
        logDb('list devices order search', orderError);
        return errorResponse(res, 'Failed to load devices', 500);
      }
      orderIds = (orders || []).map((order) => order.id);
    }

    const applyFilters = (query: any) => {
      if (status) query = query.eq('status', status);
      if (term) {
        const parts = [
          `serial_number.ilike."%${term}%"`,
          `customer_name.ilike."%${term}%"`,
          `customer_email.ilike."%${term}%"`,
          `customer_phone.ilike."%${term}%"`,
          `model_name.ilike."%${term}%"`,
        ];
        if (orderIds.length) parts.push(`order_id.in.(${orderIds.join(',')})`);
        query = query.or(parts.join(','));
      }
      return query;
    };

    const oldestFirst = status === 'pending';

    if (warranty) {
      const { data, error } = await applyFilters(
        supabaseAdmin.from('devices').select(LIST_SELECT).order('created_at', { ascending: oldestFirst })
      );
      if (error) {
        logDb('list devices', error);
        return errorResponse(res, 'Failed to load devices', 500);
      }
      const filtered = (await Promise.all(((data || []) as Record<string, any>[]).map((row) => presentDevice(row))))
        .filter((row) => row.warranty.status === warranty);
      const start = (page - 1) * limit;
      const pendingCount = await countPendingDevices();
      return paginatedResponse(res, filtered.slice(start, start + limit), {
        page,
        limit,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
      }, 'Success', { pending_count: pendingCount });
    }

    const from = (page - 1) * limit;
    const [{ data, error }, countResult] = await Promise.all([
      applyFilters(
        supabaseAdmin.from('devices').select(LIST_SELECT).order('created_at', { ascending: oldestFirst })
      ).range(from, from + limit - 1),
      applyFilters(supabaseAdmin.from('devices').select('id', { count: 'exact', head: true })),
    ]);

    if (error || countResult.error) {
      logDb('list devices', error || countResult.error);
      return errorResponse(res, 'Failed to load devices', 500);
    }

    const total = countResult.count || 0;
    const pendingCount = await countPendingDevices();
    return paginatedResponse(res, await Promise.all(((data || []) as Record<string, any>[]).map((row) => presentDevice(row))), {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    }, 'Success', { pending_count: pendingCount });
  } catch (error) {
    logDb('list devices', error);
    return errorResponse(res, 'Failed to load devices', 500);
  }
}

export async function lookupOrder(req: AuthRequest, res: Response) {
  try {
    const orderNumber = queryValue(req.query.order_number).trim();
    if (!orderNumber) return errorResponse(res, 'Enter an order number.', 400);

    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select(`
        id, order_number, user_id, customer_bio, shipping_address, created_at,
        order_items (
          id, product_id, product_name, quantity,
          product:products!order_items_product_id_fkey ( id, name, warranty_months )
        )
      `)
      .eq('order_number', orderNumber)
      .maybeSingle();

    if (error) {
      logDb('device order lookup', error);
      return errorResponse(res, 'Failed to load the order', 500);
    }
    if (!order) return errorResponse(res, 'Order not found.', 404);

    let account: { full_name?: string | null; email?: string | null; phone?: string | null } | null = null;
    if (order.user_id) {
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('full_name, email, phone')
        .eq('id', order.user_id)
        .maybeSingle();
      if (userError) {
        logDb('device order lookup user', userError);
        return errorResponse(res, 'Failed to load the order', 500);
      }
      account = user;
    }

    const { data: registered, error: registeredError } = await supabaseAdmin
      .from('devices')
      .select('id, order_item_id, unit_no, status, serial_number, warranty_months, purchase_date, product_id')
      .eq('order_id', order.id);
    if (registeredError) {
      logDb('device order lookup counts', registeredError);
      return errorResponse(res, 'Failed to load the order', 500);
    }

    const byItem = new Map<string, NonNullable<typeof registered>>();
    for (const row of registered || []) {
      if (!row.order_item_id) continue;
      const list = byItem.get(row.order_item_id) || [];
      list.push(row);
      byItem.set(row.order_item_id, list);
    }

    const customer = customerFromOrder(order, account);
    const items = (order.order_items || []).map((item: any) => {
      const product = one(item.product);
      const rows = byItem.get(item.id) || [];
      const pending = rows
        .filter((row) => row.status === 'pending')
        .sort((a, b) => (a.unit_no || 0) - (b.unit_no || 0));
      return {
        order_item_id: item.id,
        product_id: item.product_id,
        product_name: product?.name || item.product_name,
        quantity: item.quantity,
        warranty_months: product?.warranty_months ?? null,
        devices_registered: rows.filter((row) => row.status !== 'pending').length,
        pending_devices: pending.map((row) => ({
          id: row.id,
          unit_no: row.unit_no,
          warranty_months: row.warranty_months ?? product?.warranty_months ?? null,
          purchase_date: row.purchase_date,
          product_id: row.product_id || item.product_id,
        })),
      };
    });

    return successResponse(res, {
      order: {
        id: order.id,
        order_number: order.order_number,
        created_at: order.created_at,
        user_id: order.user_id,
        customer_name: customer.customer_name,
        customer_email: customer.customer_email,
        customer_phone: customer.customer_phone,
      },
      items,
    });
  } catch (error) {
    logDb('device order lookup', error);
    return errorResponse(res, 'Failed to load the order', 500);
  }
}

export async function createDevices(req: AuthRequest, res: Response) {
  try {
    const body = parseBody(createSchema, req.body, res, 'Invalid device details');
    if (!body) return;

    const seen = new Set<string>();
    for (const item of body.items) {
      const key = item.serial_number.toLowerCase();
      if (seen.has(key)) {
        return errorResponse(res, `Serial ${item.serial_number} is already registered.`, 409);
      }
      seen.add(key);
      if (item.purchase_date && !isIsoDate(item.purchase_date)) {
        return errorResponse(res, 'Purchase date must be a real date.', 400);
      }
    }

    for (const item of body.items) {
      const existing = await findSerialOwner(item.serial_number);
      if (existing) {
        return errorResponse(res, `Serial ${item.serial_number} is already registered.`, 409);
      }
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, order_number, user_id, customer_bio, shipping_address, created_at')
      .eq('id', body.order_id)
      .maybeSingle();
    if (orderError) {
      logDb('create devices order', orderError);
      return errorResponse(res, 'Failed to register devices', 500);
    }
    if (!order) return errorResponse(res, 'Order not found.', 404);

    const itemIds = [...new Set(body.items.map((item) => item.order_item_id))];
    const { data: orderItems, error: itemError } = await supabaseAdmin
      .from('order_items')
      .select(`
        id, order_id, product_id, product_name, quantity,
        product:products!order_items_product_id_fkey ( id, name, warranty_months )
      `)
      .eq('order_id', order.id)
      .in('id', itemIds);
    if (itemError) {
      logDb('create devices items', itemError);
      return errorResponse(res, 'Failed to register devices', 500);
    }

    const itemsById = new Map((orderItems || []).map((item) => [item.id, item]));

    const { data: registered, error: registeredError } = await supabaseAdmin
      .from('devices')
      .select('id, order_item_id, unit_no, status, serial_number')
      .in('order_item_id', itemIds);
    if (registeredError) {
      logDb('create devices counts', registeredError);
      return errorResponse(res, 'Failed to register devices', 500);
    }

    const existingById = new Map((registered || []).map((row) => [row.id, row]));
    const existingByItem = new Map<string, NonNullable<typeof registered>>();
    for (const row of registered || []) {
      if (!row.order_item_id) continue;
      const list = existingByItem.get(row.order_item_id) || [];
      list.push(row);
      existingByItem.set(row.order_item_id, list);
    }

    const completeItems = body.items.filter((item) => item.device_id);
    const createItems = body.items.filter((item) => !item.device_id);
    const newCounts = new Map<string, number>();
    for (const item of createItems) {
      newCounts.set(item.order_item_id, (newCounts.get(item.order_item_id) || 0) + 1);
    }

    const orderDate = dateOnly(order.created_at);
    if (!orderDate) return errorResponse(res, 'This order has no purchase date.', 400);

    let account: { full_name?: string | null; email?: string | null; phone?: string | null } | null = null;
    if (order.user_id) {
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('full_name, email, phone')
        .eq('id', order.user_id)
        .maybeSingle();
      if (userError) {
        logDb('create devices user', userError);
        return errorResponse(res, 'Failed to register devices', 500);
      }
      account = user;
    }
    const customer = customerFromOrder(order, account);
    const actor = req.user?.id ?? null;

    for (const item of completeItems) {
      const existing = existingById.get(item.device_id as string);
      if (!existing || existing.status !== 'pending' || existing.order_item_id !== item.order_item_id) {
        return errorResponse(res, 'That pending device was not found on this order.', 404);
      }
    }

    for (const item of body.items) {
      const orderItem = itemsById.get(item.order_item_id);
      if (!orderItem) return errorResponse(res, 'That item is not on this order.', 400);
      if (orderItem.product_id !== item.product_id) {
        return errorResponse(res, 'That product does not match the order item.', 400);
      }
      const product = one(orderItem.product as any);
      if (!product?.name) return errorResponse(res, 'That product is no longer available.', 400);

      const already = (existingByItem.get(item.order_item_id) || []).length;
      const incomingNew = newCounts.get(item.order_item_id) || 0;
      if (already + incomingNew > Number(orderItem.quantity || 0)) {
        return errorResponse(
          res,
          `Only ${orderItem.quantity} can be registered for ${product.name}. ${already} already exist.`,
          409
        );
      }
    }

    const savedRows: Record<string, any>[] = [];

    for (const item of completeItems) {
      const patch: Record<string, unknown> = {
        serial_number: item.serial_number,
        status: 'active',
        updated_by: actor,
      };
      if (item.warranty_months != null) patch.warranty_months = item.warranty_months;
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('devices')
        .update(patch)
        .eq('id', item.device_id)
        .eq('status', 'pending')
        .select(LIST_SELECT)
        .maybeSingle();
      if (updateError) {
        const unique = dbCode(updateError);
        if (unique.code === '23505') {
          return errorResponse(res, `Serial ${item.serial_number} is already registered.`, 409);
        }
        logDb('complete pending device', updateError);
        return errorResponse(res, 'Failed to register devices', 500);
      }
      if (!updated) return errorResponse(res, 'That pending device was not found on this order.', 404);
      await logAudit({
        req,
        entity: 'device',
        entityId: updated.id,
        action: 'activate',
        before: { id: item.device_id, status: 'pending', serial_number: null },
        after: auditDevice(updated),
      });
      savedRows.push(updated);
    }

    const rows = [];
    for (const item of createItems) {
      const orderItem = itemsById.get(item.order_item_id)!;
      const product = one(orderItem.product as any);
      const used = new Set(
        (existingByItem.get(item.order_item_id) || [])
          .map((row) => row.unit_no)
          .filter((value): value is number => Number.isInteger(value))
      );
      let unitNo = 1;
      while (used.has(unitNo)) unitNo += 1;
      used.add(unitNo);
      existingByItem.set(item.order_item_id, [
        ...(existingByItem.get(item.order_item_id) || []),
        { id: '', order_item_id: item.order_item_id, unit_no: unitNo, status: 'active', serial_number: item.serial_number },
      ]);

      const warrantyMonths = item.warranty_months ?? product.warranty_months ?? 0;
      rows.push({
        order_id: order.id,
        order_item_id: orderItem.id,
        product_id: product.id,
        user_id: customer.user_id,
        customer_name: customer.customer_name,
        customer_email: customer.customer_email,
        customer_phone: customer.customer_phone,
        model_name: product.name,
        serial_number: item.serial_number,
        unit_no: unitNo,
        purchase_date: orderDate,
        warranty_months: warrantyMonths,
        warranty_start: orderDate,
        qr_token: generateQrToken(),
        status: 'active',
        owner_linked_at: customer.user_id ? new Date().toISOString() : null,
        created_by: actor,
        updated_by: actor,
      });
    }

    if (rows.length) {
      const { data: created, error: insertError } = await supabaseAdmin
        .from('devices')
        .insert(rows)
        .select(LIST_SELECT);
      if (insertError) {
        const unique = dbCode(insertError);
        if (unique.code === '23505') {
          const serial = serialFromUniqueError(unique.details, body.items.map((item) => item.serial_number));
          logDb('create devices duplicate', insertError);
          return errorResponse(
            res,
            serial ? `Serial ${serial} is already registered.` : 'That serial number is already registered.',
            409
          );
        }
        logDb('create devices', insertError);
        return errorResponse(res, 'Failed to register devices', 500);
      }
      for (const row of created || []) {
        await logAudit({
          req,
          entity: 'device',
          entityId: row.id,
          action: 'create',
          after: auditDevice(row),
        });
        savedRows.push(row);
      }
    }

    await sendDeviceRegistrationEmail({
      to: customer.customer_email || '',
      customerName: customer.customer_name,
      devices: savedRows.map((row) => ({ model_name: row.model_name, qr_token: row.qr_token })),
    });

    return successResponse(res, await Promise.all(savedRows.map((row) => presentDevice(row))), 'Devices registered.', savedRows.some((row) => row.status === 'active') && createItems.length ? 201 : 200);
  } catch (error) {
    const unique = dbCode(error);
    if (unique.code === '23505') {
      return errorResponse(res, 'That serial number is already registered.', 409);
    }
    logDb('create devices', error);
    return errorResponse(res, 'Failed to register devices', 500);
  }
}

export async function getDevice(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Invalid device id', 400);

    const { data, error } = await supabaseAdmin
      .from('devices')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      logDb('get device', error);
      return errorResponse(res, 'Failed to load device', 500);
    }
    if (!data) return errorResponse(res, 'Device not found.', 404);

    return successResponse(res, await presentDevice(data));
  } catch (error) {
    logDb('get device', error);
    return errorResponse(res, 'Failed to load device', 500);
  }
}

export async function updateDevice(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Invalid device id', 400);
    const body = parseBody(updateSchema, req.body, res, 'Invalid device details');
    if (!body) return;
    if ('purchase_date' in (req.body || {})) {
      return errorResponse(res, 'Purchase date cannot be changed.', 400);
    }
    if (body.warranty_start && !isIsoDate(body.warranty_start)) {
      return errorResponse(res, 'Warranty start must be a real date.', 400);
    }

    const { data: before, error: beforeError } = await supabaseAdmin
      .from('devices')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (beforeError) {
      logDb('update device lookup', beforeError);
      return errorResponse(res, 'Failed to update device', 500);
    }
    if (!before) return errorResponse(res, 'Device not found.', 404);

    if (body.warranty_start) {
      if (req.user?.role !== 'superadmin') {
        return errorResponse(res, 'Only a superadmin can change the warranty start date.', 403);
      }
      if (!body.warranty_start_reason) {
        return errorResponse(res, 'Give a reason for changing the warranty start date.', 400);
      }
    }

    if (before.status === 'pending' && body.status && body.status !== 'active') {
      return errorResponse(res, 'Add a serial number to activate this device.', 400);
    }

    if (body.serial_number) {
      const existing = await findSerialOwner(body.serial_number, id);
      if (existing) return errorResponse(res, `Serial ${body.serial_number} is already registered.`, 409);
    }

    const { warranty_start_reason, ...fields } = body;
    const patch: Record<string, unknown> = { ...fields, updated_by: req.user?.id ?? null };
    const activating = before.status === 'pending' && Boolean(fields.serial_number);
    if (activating) patch.status = 'active';

    const { data, error } = await supabaseAdmin
      .from('devices')
      .update(patch)
      .eq('id', id)
      .select(DETAIL_SELECT)
      .maybeSingle();
    if (error) {
      const unique = dbCode(error);
      if (unique.code === '23505') {
        logDb('update device duplicate', error);
        return errorResponse(
          res,
          body.serial_number
            ? `Serial ${body.serial_number} is already registered.`
            : 'That serial number is already registered.',
          409
        );
      }
      logDb('update device', error);
      return errorResponse(res, 'Failed to update device', 500);
    }
    if (!data) return errorResponse(res, 'Device not found.', 404);

    await logAudit({
      req,
      entity: 'device',
      entityId: id,
      action: activating ? 'activate' : body.warranty_start ? 'warranty-start' : 'update',
      before: auditDevice(before),
      after: {
        ...auditDevice(data),
        ...(warranty_start_reason ? { warranty_start_reason } : {}),
      },
    });

    if (activating) {
      await sendDeviceRegistrationEmail({
        to: data.customer_email || '',
        customerName: data.customer_name,
        devices: [{ model_name: data.model_name, qr_token: data.qr_token }],
      });
    }

    return successResponse(res, await presentDevice(data), activating ? 'Laptop registered.' : 'Device updated.');
  } catch (error) {
    logDb('update device', error);
    return errorResponse(res, 'Failed to update device', 500);
  }
}

export async function regenerateToken(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Invalid device id', 400);

    const { data: before, error: beforeError } = await supabaseAdmin
      .from('devices')
      .select('id, serial_number, status, qr_token')
      .eq('id', id)
      .maybeSingle();
    if (beforeError) {
      logDb('regenerate device token lookup', beforeError);
      return errorResponse(res, 'Failed to regenerate the QR code', 500);
    }
    if (!before) return errorResponse(res, 'Device not found.', 404);

    const qrToken = generateQrToken();
    const { data, error } = await supabaseAdmin
      .from('devices')
      .update({ qr_token: qrToken, updated_by: req.user?.id ?? null })
      .eq('id', id)
      .select(DETAIL_SELECT)
      .maybeSingle();
    if (error) {
      logDb('regenerate device token', error);
      return errorResponse(res, 'Failed to regenerate the QR code', 500);
    }
    if (!data) return errorResponse(res, 'Device not found.', 404);

    await logAudit({
      req,
      entity: 'device',
      entityId: id,
      action: 'regenerate-token',
      before: { serial_number: before.serial_number, status: before.status },
      after: { serial_number: data.serial_number, status: data.status },
    });

    return successResponse(res, await presentDevice(data), 'QR code regenerated.');
  } catch (error) {
    logDb('regenerate device token', error);
    return errorResponse(res, 'Failed to regenerate the QR code', 500);
  }
}

export async function linkOwner(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Invalid device id', 400);
    const body = parseBody(linkSchema, req.body, res, 'Enter a valid email address.');
    if (!body) return;

    const { data: before, error: beforeError } = await supabaseAdmin
      .from('devices')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (beforeError) {
      logDb('link device owner lookup', beforeError);
      return errorResponse(res, 'Failed to link the owner', 500);
    }
    if (!before) return errorResponse(res, 'Device not found.', 404);

    const { data: users, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name')
      .ilike('email', body.email);
    if (userError) {
      logDb('link device owner user', userError);
      return errorResponse(res, 'Failed to link the owner', 500);
    }
    const account = (users || []).find((user) => String(user.email).toLowerCase() === body.email.toLowerCase());
    if (!account) return errorResponse(res, 'No account found for that email.', 404);

    if (before.user_id === account.id) {
      return successResponse(res, await presentDevice(before), 'Owner linked.');
    }

    const nextStatus = before.user_id && before.user_id !== account.id ? 'transferred' : before.status;
    const { data, error } = await supabaseAdmin
      .from('devices')
      .update({
        user_id: account.id,
        owner_linked_at: new Date().toISOString(),
        status: nextStatus,
        updated_by: req.user?.id ?? null,
      })
      .eq('id', id)
      .select(DETAIL_SELECT)
      .maybeSingle();
    if (error) {
      logDb('link device owner', error);
      return errorResponse(res, 'Failed to link the owner', 500);
    }
    if (!data) return errorResponse(res, 'Device not found.', 404);

    await logAudit({
      req,
      entity: 'device',
      entityId: id,
      action: 'link-owner',
      before: auditDevice(before),
      after: auditDevice(data),
    });

    await sendOwnerLinkedEmail({
      to: account.email || '',
      modelName: data.model_name,
      qrToken: data.qr_token,
    });

    return successResponse(res, await presentDevice(data), 'Owner linked.');
  } catch (error) {
    logDb('link device owner', error);
    return errorResponse(res, 'Failed to link the owner', 500);
  }
}

export async function unlinkOwner(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Invalid device id', 400);

    const { data: before, error: beforeError } = await supabaseAdmin
      .from('devices')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (beforeError) {
      logDb('unlink device owner lookup', beforeError);
      return errorResponse(res, 'Failed to unlink the owner', 500);
    }
    if (!before) return errorResponse(res, 'Device not found.', 404);

    if (!before.user_id) {
      return successResponse(res, await presentDevice(before), 'Owner removed.');
    }

    const { data, error } = await supabaseAdmin
      .from('devices')
      .update({ user_id: null, owner_linked_at: null, updated_by: req.user?.id ?? null })
      .eq('id', id)
      .select(DETAIL_SELECT)
      .maybeSingle();
    if (error) {
      logDb('unlink device owner', error);
      return errorResponse(res, 'Failed to unlink the owner', 500);
    }
    if (!data) return errorResponse(res, 'Device not found.', 404);

    await logAudit({
      req,
      entity: 'device',
      entityId: id,
      action: 'unlink-owner',
      before: auditDevice(before),
      after: auditDevice(data),
    });

    return successResponse(res, await presentDevice(data), 'Owner removed.');
  } catch (error) {
    logDb('unlink device owner', error);
    return errorResponse(res, 'Failed to unlink the owner', 500);
  }
}

export async function getOrderDeviceStatus(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Invalid order id', 400);
    const status = await orderDeviceStatus(id);
    if (!status) return errorResponse(res, 'Order not found.', 404);
    return successResponse(res, status);
  } catch (error) {
    logDb('order device status', error);
    return errorResponse(res, 'Failed to load device status', 500);
  }
}

export async function getLaptopWarrantyGaps(req: AuthRequest, res: Response) {
  try {
    const gaps = await countLaptopProductsWithoutWarranty();
    return successResponse(res, gaps);
  } catch (error) {
    logDb('laptop warranty gaps', error);
    return errorResponse(res, 'Failed to load warranty gaps', 500);
  }
}

export async function getLaptopOsGaps(_req: AuthRequest, res: Response) {
  try {
    const gaps = await countLaptopProductsWithoutOs();
    return successResponse(res, gaps);
  } catch (error) {
    logDb('laptop os gaps', error);
    return errorResponse(res, 'Failed to load operating system gaps', 500);
  }
}

export async function getPortalStats(_req: AuthRequest, res: Response) {
  try {
    const stats = await portalEventStats();
    return successResponse(res, stats);
  } catch (error) {
    logDb('portal stats', error);
    return errorResponse(res, 'Failed to load portal activity', 500);
  }
}
