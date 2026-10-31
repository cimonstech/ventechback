import { Request } from 'express';
import { formatPesewas } from '../utils/money';
import { supabaseAdmin } from '../utils/supabaseClient';
import { logAudit } from './audit.service';
import { emailService } from './email.service';
import { affiliateSettings } from './affiliateSettings.service';
import { AffiliateError } from './affiliate.service';
import { tryStartPreorderWarrantiesForOrder } from './deviceRegistration.service';
import {
  evaluateCommission,
  ghsToPesewas,
  type CommissionItem,
  type SkipReason,
} from './affiliateCommission.eval';

type AuditReq = Request & { user?: { id?: string; role?: string } };

interface OrderItemLike {
  product_id?: string | null;
  total_price?: number | string | null;
}

export interface CheckoutOrder {
  id: string;
  affiliate_id?: string | null;
  referral_click_id?: string | null;
  total?: number | string | null;
  discount?: number | string | null;
  payment_status?: string | null;
  status?: string | null;
  delivered_at?: string | null;
  affiliate_skip_reason?: SkipReason | null;
  shipping_address?: { payment_reference?: string | null } | null;
  order_items?: OrderItemLike[] | null;
}

interface CommissionRow {
  id: string;
  affiliate_id: string;
  order_id: string;
  checkout_reference: string;
  amount_pesewas: number;
  status: string;
  eligible_from: string | null;
  reason: string | null;
}

function logDb(scope: string, error: unknown) {
  console.error(scope, error);
}

function isUniqueViolation(error: unknown): boolean {
  return !!(error && typeof error === 'object' && (error as { code?: string }).code === '23505');
}

function paymentReferenceOf(order: CheckoutOrder): string | null {
  const ref = order.shipping_address?.payment_reference;
  return typeof ref === 'string' && ref.trim() ? ref.trim() : null;
}

function checkoutReferenceOf(order: CheckoutOrder): string {
  return paymentReferenceOf(order) || `cod:${order.id}`;
}

async function eligibleCategoryIds(slugs: string[]): Promise<Set<string>> {
  const wanted = new Set(slugs.map((slug) => slug.toLowerCase()));
  if (wanted.size === 0) return new Set();
  const { data, error } = await supabaseAdmin.from('categories').select('id, slug, parent_id');
  if (error) {
    logDb('load categories for commission', error);
    return new Set();
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

async function productCategoryMap(productIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (productIds.length === 0) return map;
  const { data, error } = await supabaseAdmin.from('products').select('id, category_id').in('id', productIds);
  if (error) {
    logDb('load products for commission', error);
    return map;
  }
  for (const row of data || []) {
    map.set(row.id, row.category_id || null);
  }
  return map;
}

function productIdsOf(orders: CheckoutOrder[]): string[] {
  const ids = new Set<string>();
  for (const order of orders) {
    for (const item of order.order_items || []) {
      if (item.product_id) ids.add(item.product_id);
    }
  }
  return [...ids];
}

const ORDER_SELECT =
  'id, affiliate_id, referral_click_id, total, discount, payment_status, status, delivered_at, shipping_address, affiliate_skip_reason, order_items:order_items(product_id, total_price)';

function itemsOf(
  orders: CheckoutOrder[],
  products: Map<string, string | null>
): CommissionItem[] {
  const items: CommissionItem[] = [];
  for (const order of orders) {
    for (const item of order.order_items || []) {
      items.push({
        categoryId: item.product_id ? products.get(item.product_id) || null : null,
        totalPricePesewas: ghsToPesewas(item.total_price),
      });
    }
  }
  return items;
}

async function evaluateOrders(orders: CheckoutOrder[]) {
  const settings = await affiliateSettings.get();
  let categoryIds = new Set<string>();
  if (settings.eligibleScope === 'categories') {
    if (settings.eligibleCategorySlugs.length === 0) {
      console.error('affiliate commission settings: eligible category list is empty');
      categoryIds = new Set();
    } else {
      categoryIds = await eligibleCategoryIds(settings.eligibleCategorySlugs);
      if (categoryIds.size === 0) {
        console.error(
          'affiliate commission settings: eligible category slugs matched no categories',
          settings.eligibleCategorySlugs
        );
      }
    }
  }
  const products = await productCategoryMap(productIdsOf(orders));
  const discountPesewas = orders.reduce((sum, order) => sum + ghsToPesewas(order.discount), 0);
  const selfReferral = orders.some((order) => order.affiliate_skip_reason === 'self_referral');
  const result = evaluateCommission({
    selfReferral,
    items: itemsOf(orders, products),
    orderDiscountPesewas: discountPesewas,
    settings: {
      eligibleScope: settings.eligibleScope,
      eligibleCategoryIds: categoryIds,
      commissionMode: settings.commissionMode,
      commissionPesewas: settings.commissionPesewas,
      percentBp: settings.percentBp,
      capPesewas: settings.capPesewas,
      minOrderPesewas: settings.minOrderPesewas,
    },
  });
  return { settings, products, categoryIds, result };
}

export async function eligibleForCommission(checkoutOrders: CheckoutOrder[]): Promise<boolean> {
  if (!checkoutOrders.length) return false;
  const { result } = await evaluateOrders(checkoutOrders);
  return result.skipReason === null && result.amountPesewas > 0;
}

async function firstEligibleOrder(
  checkoutOrders: CheckoutOrder[],
  categoryIds: Set<string>,
  products: Map<string, string | null>,
  scope: 'all' | 'categories'
): Promise<CheckoutOrder | null> {
  for (const order of checkoutOrders) {
    if (!order.affiliate_id) continue;
    if (scope === 'all') return order;
    for (const item of order.order_items || []) {
      const categoryId = item.product_id ? products.get(item.product_id) : null;
      if (categoryId && categoryIds.has(categoryId)) return order;
    }
  }
  return checkoutOrders.find((order) => order.affiliate_id) || null;
}

async function recordSkipReason(orderIds: string[], reason: SkipReason) {
  if (orderIds.length === 0) return;
  const { error } = await supabaseAdmin
    .from('orders')
    .update({ affiliate_skip_reason: reason })
    .in('id', orderIds);
  if (error) logDb('record affiliate skip reason', error);
}

async function loadAffiliateUser(affiliateId: string) {
  const { data: affiliate, error } = await supabaseAdmin
    .from('affiliates')
    .select('id, user_id')
    .eq('id', affiliateId)
    .maybeSingle();
  if (error || !affiliate) {
    if (error) logDb('load affiliate for commission email', error);
    return null;
  }
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('email, first_name, last_name, full_name')
    .eq('id', affiliate.user_id)
    .maybeSingle();
  if (userError) logDb('load affiliate user for email', userError);
  return user;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pesewasLabel(pesewas: number): string {
  return formatPesewas(pesewas);
}

async function emailAffiliatePending(affiliateId: string, amountPesewas: number) {
  const user = await loadAffiliateUser(affiliateId);
  if (!user?.email) return;
  const name = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'there';
  await emailService.sendEmail(
    {
      to: user.email,
      subject: 'A commission is pending on your account',
      html: `
        <p>Hi ${escapeHtml(name)},</p>
        <p>A commission of ${escapeHtml(pesewasLabel(amountPesewas))} is pending on your affiliate account.</p>
        <p>It becomes eligible after the order is delivered and the return window closes.</p>
        <p>VENTECH Gadgets</p>
      `,
    },
    false
  );
}

async function emailAffiliateReversal(affiliateId: string, amountPesewas: number, reason: string) {
  const user = await loadAffiliateUser(affiliateId);
  if (!user?.email) return;
  const name = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'there';
  await emailService.sendEmail(
    {
      to: user.email,
      subject: 'A commission was reversed',
      html: `
        <p>Hi ${escapeHtml(name)},</p>
        <p>A commission of ${escapeHtml(pesewasLabel(amountPesewas))} was reversed${reason ? `: ${escapeHtml(reason)}` : '.'}</p>
        <p>VENTECH Gadgets</p>
      `,
    },
    false
  );
}

async function loadOrdersWithItems(ids: string[]): Promise<CheckoutOrder[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(ORDER_SELECT)
    .in('id', ids);
  if (error) {
    logDb('load orders for commission', error);
    return [];
  }
  return (data || []) as CheckoutOrder[];
}

export async function loadCheckoutOrders(order: CheckoutOrder): Promise<CheckoutOrder[]> {
  const paymentRef = paymentReferenceOf(order);
  if (!paymentRef) {
    if (order.order_items) return [order];
    return loadOrdersWithItems([order.id]);
  }
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(ORDER_SELECT)
    .eq('shipping_address->>payment_reference', paymentRef);
  if (error) {
    logDb('load checkout orders', error);
    return order.order_items ? [order] : loadOrdersWithItems([order.id]);
  }
  return (data || []) as CheckoutOrder[];
}

export async function createPendingCommission(input: {
  req: AuditReq;
  checkoutReference: string;
  orders: CheckoutOrder[];
}): Promise<CommissionRow | null> {
  const { req, checkoutReference, orders } = input;
  if (!checkoutReference || orders.length === 0) return null;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('affiliate_commissions')
    .select('*')
    .eq('checkout_reference', checkoutReference)
    .maybeSingle();
  if (existingError) {
    logDb('load commission by checkout', existingError);
    return null;
  }
  if (existing) return existing as CommissionRow;

  const attributed = orders.filter((order) => order.affiliate_id);
  if (attributed.length === 0) return null;

  const { settings, products, categoryIds, result } = await evaluateOrders(attributed);
  const attributedIds = attributed.map((order) => order.id);
  if (result.skipReason) {
    await recordSkipReason(attributedIds, result.skipReason);
    return null;
  }
  if (result.amountPesewas <= 0) {
    await recordSkipReason(attributedIds, 'settings_error');
    return null;
  }

  const order = await firstEligibleOrder(attributed, categoryIds, products, settings.eligibleScope);
  if (!order?.affiliate_id) return null;

  const { data: affiliate, error: affiliateError } = await supabaseAdmin
    .from('affiliates')
    .select('id, status')
    .eq('id', order.affiliate_id)
    .maybeSingle();
  if (affiliateError) {
    logDb('load affiliate for commission', affiliateError);
    return null;
  }
  if (affiliate?.status !== 'active') return null;

  const insert = {
    affiliate_id: order.affiliate_id,
    order_id: order.id,
    checkout_reference: checkoutReference,
    amount_pesewas: result.amountPesewas,
    status: 'pending',
  };

  const { data, error } = await supabaseAdmin
    .from('affiliate_commissions')
    .insert(insert)
    .select('*')
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await supabaseAdmin
        .from('affiliate_commissions')
        .select('*')
        .eq('checkout_reference', checkoutReference)
        .maybeSingle();
      return (raced as CommissionRow) || null;
    }
    logDb('create pending commission', error);
    return null;
  }

  const row = data as CommissionRow;
  const { error: clearError } = await supabaseAdmin
    .from('orders')
    .update({ affiliate_skip_reason: null })
    .in('id', attributedIds);
  if (clearError) logDb('clear affiliate skip reason', clearError);
  await logAudit({
    req,
    entity: 'affiliate_commission',
    entityId: row.id,
    action: 'pending',
    after: row,
  });
  try {
    await emailAffiliatePending(row.affiliate_id, row.amount_pesewas);
  } catch (emailError) {
    logDb('email affiliate pending commission', emailError);
  }
  return row;
}

export async function maybeCreateCommissionAfterPayment(req: AuditReq, order: CheckoutOrder): Promise<void> {
  try {
    if (!order?.id) return;
    if (order.payment_status && order.payment_status !== 'paid') return;
    const checkoutOrders = await loadCheckoutOrders(order);
    const paid = checkoutOrders.filter((row) => !row.payment_status || row.payment_status === 'paid');
    if (paid.length === 0) return;
    await createPendingCommission({
      req,
      checkoutReference: checkoutReferenceOf(order),
      orders: paid.length ? paid : checkoutOrders,
    });
  } catch (error) {
    logDb('maybe create commission', error);
  }
}

export async function maybeCreateCommissionForPayment(
  req: AuditReq,
  paymentReference: string
): Promise<void> {
  try {
    if (!paymentReference) return;
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select(ORDER_SELECT)
      .eq('shipping_address->>payment_reference', paymentReference);
    if (error) {
      logDb('load payment orders for commission', error);
      return;
    }
    const orders = (data || []) as CheckoutOrder[];
    if (orders.length === 0) return;
    const paid = orders.filter((row) => row.payment_status === 'paid');
    if (paid.length === 0) return;
    await createPendingCommission({
      req,
      checkoutReference: paymentReference,
      orders: paid,
    });
  } catch (error) {
    logDb('maybe create commission for payment', error);
  }
}

export async function maybeMarkDelivered(req: AuditReq, order: CheckoutOrder): Promise<void> {
  try {
    const deliveredAt = order.delivered_at || new Date().toISOString();
    if (!order.delivered_at) {
      const { error } = await supabaseAdmin
        .from('orders')
        .update({ delivered_at: deliveredAt })
        .eq('id', order.id)
        .is('delivered_at', null);
      if (error) logDb('set delivered_at', error);
    }
    await tryStartPreorderWarrantiesForOrder(order.id, deliveredAt);

    const { data: commission, error } = await supabaseAdmin
      .from('affiliate_commissions')
      .select('*')
      .eq('order_id', order.id)
      .maybeSingle();
    if (error) {
      logDb('load commission for delivered', error);
      return;
    }
    if (!commission || commission.eligible_from) return;

    const days = await affiliateSettings.returnWindowDays();
    const eligibleFrom = new Date(new Date(deliveredAt).getTime() + Math.max(days, 0) * 24 * 60 * 60 * 1000).toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('affiliate_commissions')
      .update({ eligible_from: eligibleFrom })
      .eq('id', commission.id)
      .is('eligible_from', null)
      .select('*')
      .maybeSingle();
    if (updateError) {
      logDb('set commission eligible_from', updateError);
      return;
    }
    if (!updated) return;
    await logAudit({
      req,
      entity: 'affiliate_commission',
      entityId: updated.id,
      action: 'eligible_from_set',
      before: commission,
      after: updated,
    });
  } catch (error) {
    logDb('maybe mark delivered', error);
  }
}

export async function maybeReverseCommission(
  req: AuditReq,
  order: CheckoutOrder,
  reason: string
): Promise<void> {
  try {
    const { data: commission, error } = await supabaseAdmin
      .from('affiliate_commissions')
      .select('*')
      .eq('order_id', order.id)
      .maybeSingle();
    if (error) {
      logDb('load commission for reverse', error);
      return;
    }
    if (!commission) return;

    await recordSkipReason([order.id], 'refunded');

    if (commission.status === 'pending') {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('affiliate_commissions')
        .update({ status: 'reversed', reason })
        .eq('id', commission.id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();
      if (updateError) {
        logDb('reverse pending commission', updateError);
        return;
      }
      if (!updated) return;
      await logAudit({
        req,
        entity: 'affiliate_commission',
        entityId: updated.id,
        action: 'reversed',
        before: commission,
        after: updated,
      });
      try {
        await emailAffiliateReversal(updated.affiliate_id, updated.amount_pesewas, reason);
      } catch (emailError) {
        logDb('email affiliate reversal', emailError);
      }
      return;
    }

    if (commission.status === 'approved') {
      const { data: ledger, error: ledgerError } = await supabaseAdmin
        .from('affiliate_ledger')
        .insert({
          affiliate_id: commission.affiliate_id,
          type: 'commission_adjustment',
          amount_pesewas: -Math.abs(commission.amount_pesewas),
          commission_id: commission.id,
          note: reason,
          created_by: req.user?.id || null,
        })
        .select('*')
        .single();
      if (ledgerError) {
        if (isUniqueViolation(ledgerError)) return;
        logDb('commission adjustment ledger', ledgerError);
        return;
      }
      await logAudit({
        req,
        entity: 'affiliate_commission',
        entityId: commission.id,
        action: 'commission_adjustment',
        before: commission,
        after: ledger,
      });
      try {
        await emailAffiliateReversal(commission.affiliate_id, commission.amount_pesewas, reason);
      } catch (emailError) {
        logDb('email affiliate reversal', emailError);
      }
    }
  } catch (error) {
    logDb('maybe reverse commission', error);
  }
}

export async function maybeReverseCommissionForTransaction(
  req: AuditReq,
  transaction: {
    order_id?: string | null;
    transaction_reference?: string | null;
    paystack_reference?: string | null;
  }
): Promise<void> {
  try {
    const ids = new Set<string>();
    if (transaction.order_id) ids.add(transaction.order_id);

    const refs = [...new Set(
      [transaction.paystack_reference, transaction.transaction_reference]
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    )];

    for (const ref of refs) {
      const { data, error } = await supabaseAdmin
        .from('orders')
        .select('id')
        .eq('shipping_address->>payment_reference', ref);
      if (error) {
        logDb('load orders for transaction refund', error);
        continue;
      }
      for (const order of data || []) {
        if (order.id) ids.add(order.id);
      }
    }

    for (const id of ids) {
      await maybeReverseCommission(req, { id }, 'Order refunded');
    }
  } catch (error) {
    logDb('maybe reverse commission for transaction', error);
  }
}

export async function approveCommission(req: AuditReq, commissionId: string) {
  const { data: commission, error } = await supabaseAdmin
    .from('affiliate_commissions')
    .select('*')
    .eq('id', commissionId)
    .maybeSingle();
  if (error) {
    logDb('load commission for approve', error);
    throw new AffiliateError(500, 'Could not approve this commission.');
  }
  if (!commission) throw new AffiliateError(404, 'Commission not found.');
  if (commission.status !== 'pending') {
    throw new AffiliateError(409, 'This commission cannot be approved.');
  }
  if (!commission.eligible_from || new Date(commission.eligible_from).getTime() > Date.now()) {
    throw new AffiliateError(400, 'This commission is not eligible yet.');
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, status, payment_status')
    .eq('id', commission.order_id)
    .maybeSingle();
  if (orderError) {
    logDb('load order for commission approve', orderError);
    throw new AffiliateError(500, 'Could not approve this commission.');
  }
  if (!order || order.status !== 'delivered' || order.payment_status !== 'paid') {
    throw new AffiliateError(400, 'This order is not delivered and paid.');
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('affiliate_commissions')
    .update({
      status: 'approved',
      verified_by: req.user?.id || null,
      verified_at: now,
    })
    .eq('id', commission.id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (updateError) {
    logDb('approve commission', updateError);
    throw new AffiliateError(500, 'Could not approve this commission.');
  }
  if (!updated) throw new AffiliateError(409, 'This commission cannot be approved.');

  const { data: ledger, error: ledgerError } = await supabaseAdmin
    .from('affiliate_ledger')
    .insert({
      affiliate_id: updated.affiliate_id,
      type: 'commission_approved',
      amount_pesewas: updated.amount_pesewas,
      commission_id: updated.id,
      note: 'Commission approved',
      created_by: req.user?.id || null,
    })
    .select('*')
    .single();
  if (ledgerError && !isUniqueViolation(ledgerError)) {
    logDb('commission approved ledger', ledgerError);
    throw new AffiliateError(500, 'Could not approve this commission.');
  }

  await logAudit({
    req,
    entity: 'affiliate_commission',
    entityId: updated.id,
    action: 'approved',
    before: commission,
    after: { commission: updated, ledger },
  });
  return updated;
}

export async function reverseCommissionById(req: AuditReq, commissionId: string, reason: string) {
  const { data: commission, error } = await supabaseAdmin
    .from('affiliate_commissions')
    .select('*')
    .eq('id', commissionId)
    .maybeSingle();
  if (error) {
    logDb('load commission for admin reverse', error);
    throw new AffiliateError(500, 'Could not reverse this commission.');
  }
  if (!commission) throw new AffiliateError(404, 'Commission not found.');
  if (commission.status === 'reversed') {
    throw new AffiliateError(409, 'This commission is already reversed.');
  }
  await maybeReverseCommission(req, { id: commission.order_id }, reason);
  const { data: latest } = await supabaseAdmin
    .from('affiliate_commissions')
    .select('*')
    .eq('id', commissionId)
    .maybeSingle();
  return latest || commission;
}
