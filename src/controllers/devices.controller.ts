import { Response } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { AuthRequest } from '../middleware/auth.middleware';
import { errorResponse, successResponse } from '../utils/responseHandlers';
import { logAudit } from '../services/audit.service';
import { emptyGuides, guidesForProduct } from '../services/contentGuides.service';
import {
  claimCodesMatch,
  generateClaimCode,
  hashClaimCode,
  maskEmail,
  sendClaimCodeEmail,
  toOwnerView,
  toPublicView,
} from '../services/device.service';

const PUBLIC_SELECT = `
  id, user_id, product_id, order_id, customer_name, customer_email,
  model_name, serial_number, purchase_date, warranty_months, warranty_start, status,
  product:products!devices_product_id_fkey(slug, thumbnail),
  order:orders!devices_order_id_fkey(id, order_number)
`;

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function logDb(scope: string, error: unknown) {
  console.error(scope, error);
}

async function deviceByToken(token: string) {
  const { data, error } = await supabaseAdmin
    .from('devices')
    .select(PUBLIC_SELECT)
    .eq('qr_token', token)
    .maybeSingle();
  return { data, error };
}

async function guidesForDevice(productId: string | null) {
  if (!productId) return emptyGuides();
  const loaded = await guidesForProduct(productId);
  if (loaded.ok) return loaded.guides;
  if (loaded.code === 'failed') {
    console.error('Device guides failed to load');
  }
  return emptyGuides();
}

export async function publicDevice(req: AuthRequest, res: Response) {
  try {
    const token = param(req.params.token).trim();
    if (!token) return errorResponse(res, 'Device not found.', 404);

    const { data, error } = await deviceByToken(token);
    if (error) {
      logDb('public device', error);
      return errorResponse(res, 'Failed to load this laptop', 500);
    }
    if (!data || data.status === 'retired') return errorResponse(res, 'Device not found.', 404);

    const product = one(data.product);
    const order = one(data.order);
    const guides = await guidesForDevice(data.product_id);
    const isOwner = Boolean(req.user?.id && data.user_id && req.user.id === data.user_id);

    if (isOwner) {
      return successResponse(res, {
        view: 'owner',
        ...toOwnerView(data, product, order),
        guides,
      });
    }

    return successResponse(res, {
      view: 'public',
      claimable: data.user_id === null,
      ...toPublicView(data, product),
      guides,
    });
  } catch (error) {
    logDb('public device', error);
    return errorResponse(res, 'Failed to load this laptop', 500);
  }
}

export async function claimDevice(req: AuthRequest, res: Response) {
  try {
    const token = param(req.params.token).trim();
    const userId = req.user?.id;
    if (!userId) return errorResponse(res, 'Unauthorized', 401);

    const { data, error } = await deviceByToken(token);
    if (error) {
      logDb('claim device', error);
      return errorResponse(res, 'Failed to send the claim code', 500);
    }
    if (!data || data.status === 'retired') return errorResponse(res, 'Device not found.', 404);
    if (data.user_id) return errorResponse(res, 'This laptop is already registered.', 409);
    if (!data.customer_email) {
      return errorResponse(res, "This laptop can't be claimed online. Please contact VENTECH support.", 409);
    }

    const code = generateClaimCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { data: claim, error: claimError } = await supabaseAdmin
      .from('device_claims')
      .insert({
        device_id: data.id,
        user_id: userId,
        code_hash: hashClaimCode(code, data.id),
        expires_at: expiresAt,
      })
      .select('id')
      .single();
    if (claimError || !claim) {
      logDb('claim device insert', claimError);
      return errorResponse(res, 'Failed to send the claim code', 500);
    }

    try {
      const sent = await sendClaimCodeEmail(data.customer_email, code);
      if (!sent) {
        await supabaseAdmin.from('device_claims').delete().eq('id', claim.id);
        return errorResponse(res, "We couldn't send the code. Please try again.", 503);
      }
    } catch (emailError) {
      console.error('claim code email failed', emailError);
      await supabaseAdmin.from('device_claims').delete().eq('id', claim.id);
      return errorResponse(res, "We couldn't send the code. Please try again.", 503);
    }

    return successResponse(res, { sentTo: maskEmail(data.customer_email) }, 'Claim code sent.');
  } catch (error) {
    logDb('claim device', error);
    return errorResponse(res, 'Failed to send the claim code', 500);
  }
}

export async function verifyClaim(req: AuthRequest, res: Response) {
  try {
    const token = param(req.params.token).trim();
    const userId = req.user?.id;
    if (!userId) return errorResponse(res, 'Unauthorized', 401);

    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!/^\d{6}$/.test(code)) return errorResponse(res, 'That code is not correct.', 400);

    const { data, error } = await deviceByToken(token);
    if (error) {
      logDb('verify claim device', error);
      return errorResponse(res, 'Failed to verify the code', 500);
    }
    if (!data || data.status === 'retired') return errorResponse(res, 'Device not found.', 404);
    if (data.user_id) return errorResponse(res, 'This laptop is already registered.', 409);

    const now = new Date().toISOString();
    const { data: claim, error: claimError } = await supabaseAdmin
      .from('device_claims')
      .select('id, code_hash, expires_at, attempts')
      .eq('device_id', data.id)
      .eq('user_id', userId)
      .is('used_at', null)
      .gt('expires_at', now)
      .lt('attempts', 5)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (claimError) {
      logDb('verify claim lookup', claimError);
      return errorResponse(res, 'Failed to verify the code', 500);
    }

    if (!claim) {
      const { data: latest, error: latestError } = await supabaseAdmin
        .from('device_claims')
        .select('expires_at, attempts')
        .eq('device_id', data.id)
        .eq('user_id', userId)
        .is('used_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) {
        logDb('verify claim latest', latestError);
        return errorResponse(res, 'Failed to verify the code', 500);
      }
      const expired = latest ? new Date(latest.expires_at).getTime() <= Date.now() : false;
      if (latest && (expired || latest.attempts >= 5)) {
        return errorResponse(res, 'That code has expired. Request a new one.', 400);
      }
      return errorResponse(res, 'That code is not correct.', 400);
    }

    if (!claimCodesMatch(claim.code_hash, code, data.id)) {
      const { error: attemptError } = await supabaseAdmin
        .from('device_claims')
        .update({ attempts: claim.attempts + 1 })
        .eq('id', claim.id)
        .eq('attempts', claim.attempts);
      if (attemptError) logDb('verify claim attempts', attemptError);
      return errorResponse(res, 'That code is not correct.', 400);
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('devices')
      .update({ user_id: userId })
      .eq('id', data.id)
      .is('user_id', null)
      .select('id')
      .maybeSingle();
    if (updateError) {
      logDb('verify claim link', updateError);
      return errorResponse(res, 'Failed to verify the code', 500);
    }
    if (!updated) return errorResponse(res, 'This laptop is already registered.', 409);

    const { error: usedError } = await supabaseAdmin
      .from('device_claims')
      .update({ used_at: new Date().toISOString() })
      .eq('id', claim.id)
      .is('used_at', null);
    if (usedError) logDb('verify claim used', usedError);

    await logAudit({
      req,
      entity: 'device',
      entityId: data.id,
      action: 'claim',
      before: { user_id: null },
      after: { user_id: userId },
    });

    const product = one(data.product);
    const order = one(data.order);
    return successResponse(
      res,
      toOwnerView(data, product, order),
      'Laptop added to your account.'
    );
  } catch (error) {
    logDb('verify claim', error);
    return errorResponse(res, 'Failed to verify the code', 500);
  }
}

export async function listMine(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return errorResponse(res, 'Unauthorized', 401);

    const { data, error } = await supabaseAdmin
      .from('devices')
      .select(PUBLIC_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      logDb('list my devices', error);
      return errorResponse(res, 'Failed to load your laptops', 500);
    }

    const devices = (data || []).map((row) => toOwnerView(row, one(row.product), one(row.order)));
    return successResponse(res, devices);
  } catch (error) {
    logDb('list my devices', error);
    return errorResponse(res, 'Failed to load your laptops', 500);
  }
}
