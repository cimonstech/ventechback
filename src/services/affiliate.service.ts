import axios from 'axios';
import crypto from 'crypto';
import { Request } from 'express';
import { adminNotificationEmail } from '../config/email';
import { AuthRequest } from '../middleware/auth.middleware';
import { supabaseAdmin } from '../utils/supabaseClient';
import { logAudit } from './audit.service';
import { emailService } from './email.service';
import { affiliateSettings } from './affiliateSettings.service';

export class AffiliateError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'AffiliateError';
  }
}

export interface AffiliateRow {
  id: string;
  user_id: string;
  status: string;
  affiliate_no: string | null;
  referral_code: string;
  promo_channels: string[] | null;
  social_handles: Record<string, string> | null;
  payout_method: string | null;
  fee_amount_pesewas: number | null;
  fee_reference: string | null;
  fee_paid_at: string | null;
  terms_version: number | null;
  terms_accepted_at: string | null;
  approved_at: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface RegisterInput {
  promo_channels: string[];
  social_handles: Record<string, string>;
  payout_method: 'momo' | 'bank';
  momo_network?: string;
  momo_number?: string;
  bank_name?: string;
  bank_account_name?: string;
  bank_account_number?: string;
  accept_terms: true;
}

export interface Attribution {
  affiliateId: string;
  clickId: string;
}

type AuditReq = Request & { user?: { id?: string; role?: string } };

function logDb(scope: string, error: unknown) {
  console.error(scope, error);
}

function isUniqueViolation(error: unknown): boolean {
  return !!(error && typeof error === 'object' && (error as { code?: string }).code === '23505');
}

export function isInactiveAffiliateError(error: unknown): boolean {
  const parts: string[] = [];
  if (error instanceof Error) parts.push(error.message);
  if (error && typeof error === 'object') {
    const row = error as { message?: unknown; details?: unknown; hint?: unknown };
    if (row.message) parts.push(String(row.message));
    if (row.details) parts.push(String(row.details));
    if (row.hint) parts.push(String(row.hint));
  }
  return parts.join(' ').includes('Affiliate is not active.');
}

function digits(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

function lower(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function siteOrigin(): string | null {
  const raw = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    (process.env.FRONTEND_URL || '').split(',')[0] ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = forwarded
    ? typeof forwarded === 'string'
      ? forwarded.split(',')[0]
      : forwarded[0]
    : req.ip || req.socket.remoteAddress || '';
  return String(raw || '').trim() || 'unknown';
}

function pendingReferralCode(): string {
  return `PENDING-${crypto.randomBytes(5).toString('hex')}`;
}

function feeReference(affiliateId: string): string {
  const compact = affiliateId.replace(/-/g, '').slice(0, 12);
  return `AFFFEE_${compact}_${Date.now()}`;
}

export function presentAffiliate(row: AffiliateRow) {
  return {
    id: row.id,
    status: row.status,
    affiliate_no: row.affiliate_no,
    referral_code: row.status === 'active' ? row.referral_code : null,
    fee_paid_at: row.fee_paid_at,
    fee_amount_pesewas: row.fee_amount_pesewas,
    terms_version: row.terms_version,
    terms_accepted_at: row.terms_accepted_at,
    created_at: row.created_at,
  };
}

export async function loadAffiliateByUser(userId: string): Promise<AffiliateRow | null> {
  const { data, error } = await supabaseAdmin
    .from('affiliates')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    logDb('load affiliate by user', error);
    throw new AffiliateError(500, 'Could not load your affiliate application.');
  }
  return (data as AffiliateRow) || null;
}

export async function loadAffiliateById(id: string): Promise<AffiliateRow | null> {
  const { data, error } = await supabaseAdmin
    .from('affiliates')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logDb('load affiliate by id', error);
    throw new AffiliateError(500, 'Could not load this affiliate application.');
  }
  return (data as AffiliateRow) || null;
}

async function publishedTerms() {
  const { data, error } = await supabaseAdmin
    .from('content_pages')
    .select('id, slug, status, version')
    .eq('slug', 'affiliate-terms')
    .maybeSingle();
  if (error) {
    logDb('affiliate terms', error);
    throw new AffiliateError(500, 'Could not load affiliate terms.');
  }
  if (!data || data.status !== 'published') return null;
  return data;
}

async function nextAffiliateNo(): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('next_affiliate_no');
  if (!error && typeof data === 'string' && /^VT-AFF-\d+$/.test(data)) {
    return data;
  }
  logDb('next_affiliate_no', error || data);
  throw new AffiliateError(500, 'Could not assign an affiliate number. Please try again.');
}

export async function grantAffiliateRole(userId: string, status: 'pending' | 'active' | 'suspended' = 'active') {
  const { data: existing, error: loadError } = await supabaseAdmin
    .from('user_roles')
    .select('id, status')
    .eq('user_id', userId)
    .eq('role', 'affiliate')
    .maybeSingle();
  if (loadError) {
    logDb('load user_roles affiliate', loadError);
    throw new AffiliateError(500, 'Could not update this affiliate role.');
  }
  if (existing) {
    if (existing.status === status) return;
    const patch: Record<string, unknown> = { status };
    if (status === 'active') patch.granted_at = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('user_roles')
      .update(patch)
      .eq('id', existing.id);
    if (error) {
      logDb('update user_roles affiliate', error);
      throw new AffiliateError(500, 'Could not update this affiliate role.');
    }
    return;
  }
  if (status !== 'active' && status !== 'pending') return;
  const { error } = await supabaseAdmin.from('user_roles').insert({
    user_id: userId,
    role: 'affiliate',
    status,
    granted_at: status === 'active' ? new Date().toISOString() : null,
  });
  if (error && !isUniqueViolation(error)) {
    logDb('insert user_roles affiliate', error);
    throw new AffiliateError(500, 'Could not update this affiliate role.');
  }
}

export async function activateAffiliate(row: AffiliateRow, req: AuditReq): Promise<AffiliateRow> {
  if (row.status === 'active' && row.affiliate_no) return row;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const affiliateNo = await nextAffiliateNo();
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('affiliates')
      .update({
        status: 'active',
        affiliate_no: affiliateNo,
        referral_code: affiliateNo,
        approved_at: row.approved_at || now,
        approved_by: row.approved_by || req.user?.id || null,
        suspended_reason: null,
        rejected_reason: null,
      })
      .eq('id', row.id)
      .select('*')
      .single();
    if (!error && data) {
      await grantAffiliateRole(row.user_id);
      await logAudit({
        req,
        entity: 'affiliate',
        entityId: row.id,
        action: 'activated',
        before: row,
        after: data,
      });
      return data as AffiliateRow;
    }
    lastError = error;
    if (isUniqueViolation(error)) continue;
    logDb('activate affiliate', error);
    throw new AffiliateError(500, 'Could not activate this affiliate.');
  }
  logDb('activate affiliate unique', lastError);
  throw new AffiliateError(500, 'Could not activate this affiliate.');
}

async function loadUserContact(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, phone, first_name, last_name, full_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    logDb('load user contact', error);
    return null;
  }
  return data;
}

async function emailApplicantPaid(userId: string) {
  const user = await loadUserContact(userId);
  if (!user?.email) return;
  const name = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'there';
  await emailService.sendEmail(
    {
      to: user.email,
      subject: 'Payment received, your application is under review',
      html: `
        <p>Hi ${escapeHtml(name)},</p>
        <p>We received your affiliate application fee. Your application is under review.</p>
        <p>We will email you when a decision is ready.</p>
        <p>VENTECH Gadgets</p>
      `,
    },
    false
  );
}

async function emailAdminNewApplication(userId: string, affiliate: AffiliateRow) {
  const user = await loadUserContact(userId);
  const name = user?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Applicant';
  await emailService.sendEmail(
    {
      to: adminNotificationEmail,
      subject: 'New affiliate application',
      html: `
        <p>A new affiliate application is ready for review.</p>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(user?.email || 'unknown')}</p>
        <p><strong>Affiliate id:</strong> ${escapeHtml(affiliate.id)}</p>
        <p><strong>Status:</strong> ${escapeHtml(affiliate.status)}</p>
      `,
    },
    true
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function registerAffiliate(req: AuthRequest, input: RegisterInput): Promise<AffiliateRow> {
  const userId = req.user?.id as string;
  const existing = await loadAffiliateByUser(userId);
  if (existing) {
    if (existing.status === 'awaiting_payment') return existing;
    throw new AffiliateError(409, 'You already have an affiliate application.');
  }

  const terms = await publishedTerms();
  if (!terms) {
    throw new AffiliateError(409, 'Affiliate terms are not available yet.');
  }

  const now = new Date().toISOString();
  const insertBase = {
    user_id: userId,
    status: 'awaiting_payment',
    promo_channels: input.promo_channels,
    social_handles: input.social_handles,
    payout_method: input.payout_method,
    momo_network: input.payout_method === 'momo' ? input.momo_network || null : null,
    momo_number: input.payout_method === 'momo' ? input.momo_number || null : null,
    bank_name: input.payout_method === 'bank' ? input.bank_name || null : null,
    bank_account_name: input.payout_method === 'bank' ? input.bank_account_name || null : null,
    bank_account_number: input.payout_method === 'bank' ? input.bank_account_number || null : null,
    terms_version: terms.version,
    terms_accepted_at: now,
  };

  let created: AffiliateRow | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabaseAdmin
      .from('affiliates')
      .insert({
        ...insertBase,
        referral_code: pendingReferralCode(),
      })
      .select('*')
      .single();
    if (!error && data) {
      created = data as AffiliateRow;
      break;
    }
    lastError = error;
    if (isUniqueViolation(error)) {
      const raced = await loadAffiliateByUser(userId);
      if (raced) {
        if (raced.status === 'awaiting_payment') return raced;
        throw new AffiliateError(409, 'You already have an affiliate application.');
      }
      continue;
    }
    logDb('register affiliate', error);
    throw new AffiliateError(500, 'Could not create your affiliate application.');
  }

  if (!created) {
    logDb('register affiliate retry', lastError);
    throw new AffiliateError(500, 'Could not create your affiliate application.');
  }

  await logAudit({
    req,
    entity: 'affiliate',
    entityId: created.id,
    action: 'register',
    after: created,
  });
  return created;
}

async function paystackInitialize(payload: Record<string, unknown>) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new AffiliateError(500, 'Could not start the payment.');
  try {
    const response = await axios.post('https://api.paystack.co/transaction/initialize', payload, {
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
    if (!response.data?.status || !response.data?.data) {
      logDb('paystack initialize affiliate fee', response.data);
      throw new AffiliateError(502, 'Could not start the payment.');
    }
    return response.data.data as {
      authorization_url: string;
      access_code: string;
      reference: string;
    };
  } catch (error) {
    if (error instanceof AffiliateError) throw error;
    logDb('paystack initialize affiliate fee', error);
    throw new AffiliateError(502, 'Could not start the payment.');
  }
}

async function paystackVerify(reference: string) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new AffiliateError(500, 'Could not verify this payment.');
  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        timeout: 15000,
      }
    );
    return response.data?.data || null;
  } catch (error) {
    logDb('paystack verify affiliate fee', error);
    throw new AffiliateError(502, 'Could not verify this payment.');
  }
}

export async function initializeAffiliateFee(req: AuthRequest) {
  const userId = req.user?.id as string;
  const affiliate = await loadAffiliateByUser(userId);
  if (!affiliate) throw new AffiliateError(404, 'Affiliate application not found.');
  if (affiliate.user_id !== userId) throw new AffiliateError(404, 'Affiliate application not found.');
  if (!affiliate.terms_accepted_at) {
    throw new AffiliateError(400, 'Please accept the affiliate terms first.');
  }
  if (affiliate.status !== 'awaiting_payment') {
    throw new AffiliateError(400, 'This application is not waiting for a fee payment.');
  }

  const origin = siteOrigin();
  if (!origin) throw new AffiliateError(500, 'Could not start the payment.');

  const user = await loadUserContact(userId);
  if (!user?.email) throw new AffiliateError(400, 'Your account needs an email address to pay.');

  const amount = await affiliateSettings.feePesewas();
  if (amount <= 0) throw new AffiliateError(500, 'Could not start the payment.');

  const reference = feeReference(affiliate.id);
  const { error: storeError } = await supabaseAdmin
    .from('affiliates')
    .update({ fee_reference: reference })
    .eq('id', affiliate.id)
    .eq('user_id', userId)
    .eq('status', 'awaiting_payment');
  if (storeError) {
    logDb('store affiliate fee reference', storeError);
    throw new AffiliateError(500, 'Could not start the payment.');
  }

  const paystack = await paystackInitialize({
    email: user.email,
    amount,
    reference,
    currency: 'GHS',
    callback_url: `${origin}/affiliate/payment-callback`,
    metadata: {
      purpose: 'affiliate_fee',
      affiliate_id: affiliate.id,
    },
  });

  await logAudit({
    req,
    entity: 'affiliate',
    entityId: affiliate.id,
    action: 'fee_initialize',
    after: { reference: paystack.reference || reference, amount_pesewas: amount },
  });

  return {
    authorization_url: paystack.authorization_url,
    access_code: paystack.access_code,
    reference: paystack.reference || reference,
    amount_pesewas: amount,
  };
}

export async function applyAffiliateFeePaid(
  req: AuditReq,
  reference: string,
  expectedUserId?: string | null
): Promise<{ affiliate: AffiliateRow; already: boolean }> {
  const transaction = await paystackVerify(reference);
  if (!transaction || transaction.status !== 'success') {
    throw new AffiliateError(400, 'This payment has not been confirmed.');
  }

  const metadata = transaction.metadata || {};
  const purpose = metadata.purpose;
  const metadataAffiliateId = metadata.affiliate_id ? String(metadata.affiliate_id) : null;

  if (purpose && purpose !== 'affiliate_fee') {
    throw new AffiliateError(400, 'This payment is not an affiliate application fee.');
  }

  let affiliate: AffiliateRow | null = null;
  if (metadataAffiliateId) {
    affiliate = await loadAffiliateById(metadataAffiliateId);
  }
  if (!affiliate) {
    const { data, error } = await supabaseAdmin
      .from('affiliates')
      .select('*')
      .eq('fee_reference', reference)
      .maybeSingle();
    if (error) {
      logDb('load affiliate by fee reference', error);
      throw new AffiliateError(500, 'Could not verify this payment.');
    }
    affiliate = (data as AffiliateRow) || null;
  }

  if (!affiliate) {
    throw new AffiliateError(404, 'Affiliate application not found.');
  }
  if (expectedUserId && affiliate.user_id !== expectedUserId) {
    throw new AffiliateError(404, 'Affiliate application not found.');
  }
  if (metadataAffiliateId && metadataAffiliateId !== affiliate.id) {
    throw new AffiliateError(400, 'This payment does not match this application.');
  }
  if (purpose !== 'affiliate_fee' && !affiliate.fee_reference) {
    throw new AffiliateError(400, 'This payment is not an affiliate application fee.');
  }

  if (affiliate.fee_paid_at) {
    return { affiliate, already: true };
  }

  const expectedAmount = await affiliateSettings.feePesewas();
  const paidAmount = Number(transaction.amount);
  if (!Number.isFinite(paidAmount) || paidAmount !== expectedAmount) {
    throw new AffiliateError(400, 'This payment does not match the application fee.');
  }

  const now = new Date().toISOString();
  const { data: paid, error: paidError } = await supabaseAdmin
    .from('affiliates')
    .update({
      fee_paid_at: now,
      fee_amount_pesewas: paidAmount,
      fee_reference: reference,
      status: 'pending',
    })
    .eq('id', affiliate.id)
    .is('fee_paid_at', null)
    .select('*')
    .maybeSingle();

  if (paidError) {
    logDb('mark affiliate fee paid', paidError);
    throw new AffiliateError(500, 'Could not record this payment.');
  }

  if (!paid) {
    const latest = await loadAffiliateById(affiliate.id);
    if (latest?.fee_paid_at) return { affiliate: latest, already: true };
    throw new AffiliateError(500, 'Could not record this payment.');
  }

  let next = paid as AffiliateRow;
  await logAudit({
    req,
    entity: 'affiliate',
    entityId: next.id,
    action: 'fee_paid',
    before: affiliate,
    after: next,
  });

  const mode = await affiliateSettings.activationMode();
  if (mode === 'automatic') {
    next = await activateAffiliate(next, req);
  }

  try {
    await emailApplicantPaid(next.user_id);
  } catch (error) {
    logDb('email affiliate applicant', error);
  }
  try {
    await emailAdminNewApplication(next.user_id, next);
  } catch (error) {
    logDb('email admin affiliate application', error);
  }

  return { affiliate: next, already: false };
}

export async function verifyAffiliateFee(req: AuthRequest, reference: string) {
  return applyAffiliateFeePaid(req, reference, req.user?.id);
}

export async function trackClick(
  req: Request,
  input: { code: string; landing_url: string; product_slug?: string }
): Promise<{ click_id: string; expires_at: string }> {
  const salt = process.env.AFFILIATE_IP_SALT;
  if (!salt) {
    throw new AffiliateError(503, 'This is not available right now.');
  }

  const { data: affiliate, error: affiliateError } = await supabaseAdmin
    .from('affiliates')
    .select('id, status, referral_code')
    .eq('referral_code', input.code)
    .eq('status', 'active')
    .maybeSingle();
  if (affiliateError) {
    logDb('load affiliate by code', affiliateError);
    throw new AffiliateError(404, 'Not found.');
  }
  if (!affiliate) {
    throw new AffiliateError(404, 'Not found.');
  }

  let productId: string | null = null;
  if (input.product_slug) {
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('slug', input.product_slug)
      .maybeSingle();
    if (productError) logDb('load product for click', productError);
    productId = product?.id || null;
  }

  const ipHash = crypto.createHash('sha256').update(`${clientIp(req)}${salt}`).digest('hex');
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 1000) || null;

  const { data: click, error: clickError } = await supabaseAdmin
    .from('affiliate_clicks')
    .insert({
      affiliate_id: affiliate.id,
      referral_code: affiliate.referral_code,
      landing_url: input.landing_url,
      product_id: productId,
      ip_hash: ipHash,
      user_agent: userAgent,
    })
    .select('id')
    .single();

  if (clickError || !click) {
    if (isInactiveAffiliateError(clickError)) {
      throw new AffiliateError(404, 'Not found.');
    }
    logDb('insert affiliate click', clickError);
    throw new AffiliateError(404, 'Not found.');
  }

  const days = await affiliateSettings.attributionDays();
  const expiresAt = new Date(Date.now() + Math.max(days, 0) * 24 * 60 * 60 * 1000).toISOString();
  return { click_id: click.id, expires_at: expiresAt };
}

export async function resolveReferralAttribution(input: {
  clickId?: string | null;
  buyerUserId?: string | null;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
}): Promise<Attribution | null> {
  const clickId = (input.clickId || '').trim();
  if (!clickId) return null;

  try {
    const { data: click, error } = await supabaseAdmin
      .from('affiliate_clicks')
      .select('id, affiliate_id, created_at')
      .eq('id', clickId)
      .maybeSingle();
    if (error || !click) return null;

    const { data: affiliate, error: affiliateError } = await supabaseAdmin
      .from('affiliates')
      .select('id, user_id, status')
      .eq('id', click.affiliate_id)
      .maybeSingle();
    if (affiliateError || !affiliate || affiliate.status !== 'active') return null;

    const days = await affiliateSettings.attributionDays();
    const createdAt = new Date(click.created_at).getTime();
    const expiresAt = createdAt + Math.max(days, 0) * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(createdAt) || Date.now() > expiresAt) return null;

    const affiliateUser = await loadUserContact(affiliate.user_id);
    const buyerUser = input.buyerUserId ? await loadUserContact(input.buyerUserId) : null;

    const buyerIds = [input.buyerUserId, buyerUser?.id].filter(Boolean).map(String);
    if (buyerIds.includes(String(affiliate.user_id))) return null;

    const buyerEmails = [input.buyerEmail, buyerUser?.email].map(lower).filter(Boolean);
    const affiliateEmail = lower(affiliateUser?.email);
    if (affiliateEmail && buyerEmails.includes(affiliateEmail)) return null;

    const buyerPhones = [input.buyerPhone, buyerUser?.phone].map(digits).filter((value) => value.length >= 7);
    const affiliatePhone = digits(affiliateUser?.phone);
    if (affiliatePhone.length >= 7 && buyerPhones.includes(affiliatePhone)) return null;

    return { affiliateId: affiliate.id, clickId: click.id };
  } catch (error) {
    logDb('resolve referral', error);
    return null;
  }
}
