import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { loadAffiliateByUser } from '../services/affiliate.service';
import { getSummary, presentLinks } from '../services/affiliateWallet.service';
import { warrantyStatus } from '../services/device.service';
import { OPEN_STATUSES } from '../services/ticket.service';
import { supabaseAdmin } from '../utils/supabaseClient';
import { errorResponse, successResponse } from '../utils/responseHandlers';

function logDb(scope: string, error: unknown) {
  console.error(scope, error);
}

function horizonDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value ?? null;
}

export async function getMyOverview(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id as string | undefined;
    if (!userId) return errorResponse(res, 'Unauthorized', 401);

    const role = String(req.user?.role || 'customer');
    const today = new Date().toISOString().slice(0, 10);
    const soon = horizonDate(60);

    const [ordersResult, devicesResult, ticketsResult, wishlistResult, rolesResult, affiliateRow] = await Promise.all([
      supabaseAdmin
        .from('orders')
        .select('order_number, created_at, status, payment_status, total', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('devices')
        .select('model_name, warranty_start, warranty_months, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('service_tickets')
        .select('ticket_no, laptop_model, status, updated_at', { count: 'exact' })
        .eq('user_id', userId)
        .in('status', [...OPEN_STATUSES])
        .order('updated_at', { ascending: false })
        .limit(3),
      supabaseAdmin
        .from('wishlists')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabaseAdmin
        .from('user_roles')
        .select('role, status')
        .eq('user_id', userId),
      loadAffiliateByUser(userId),
    ]);

    if (ordersResult.error) {
      logDb('me overview orders', ordersResult.error);
      return errorResponse(res, 'Could not load your account', 500);
    }
    if (devicesResult.error) {
      logDb('me overview devices', devicesResult.error);
      return errorResponse(res, 'Could not load your account', 500);
    }
    if (ticketsResult.error) {
      logDb('me overview tickets', ticketsResult.error);
      return errorResponse(res, 'Could not load your account', 500);
    }
    if (wishlistResult.error) {
      logDb('me overview wishlist', wishlistResult.error);
      return errorResponse(res, 'Could not load your account', 500);
    }
    if (rolesResult.error) {
      logDb('me overview roles', rolesResult.error);
      return errorResponse(res, 'Could not load your account', 500);
    }

    const latestOrder = one(ordersResult.data);
    const devices = devicesResult.data || [];
    const endingSoon = devices.filter((device) => {
      const warranty = warrantyStatus(device);
      return Boolean(warranty.endsOn && warranty.endsOn >= today && warranty.endsOn <= soon);
    }).length;

    let affiliate: { available_pesewas: number; pending_pesewas: number; link: string | null } | null = null;
    if (affiliateRow && affiliateRow.user_id === userId && affiliateRow.status === 'active') {
      try {
        const summary = await getSummary(userId);
        affiliate = {
          available_pesewas: summary.available_pesewas,
          pending_pesewas: summary.pending_pesewas,
          link: presentLinks(affiliateRow)?.general || null,
        };
      } catch (error) {
        logDb('me overview affiliate', error);
        return errorResponse(res, 'Could not load your account', 500);
      }
    }

    return successResponse(res, {
      orders: {
        count: ordersResult.count || 0,
        latest: latestOrder
          ? {
              order_number: latestOrder.order_number,
              date: latestOrder.created_at,
              status: latestOrder.status,
              payment_status: latestOrder.payment_status,
              total: latestOrder.total,
            }
          : null,
      },
      devices: {
        count: devices.length,
        items: devices.slice(0, 3).map((device) => {
          const warranty = warrantyStatus(device);
          return {
            model: device.model_name,
            warranty_status: warranty.status,
            warranty_end: warranty.endsOn,
          };
        }),
        warranty_ending_soon: endingSoon,
      },
      service_requests: {
        open_count: ticketsResult.count || 0,
        open: (ticketsResult.data || []).map((ticket) => ({
          ticket_number: ticket.ticket_no,
          model: ticket.laptop_model,
          status: ticket.status,
          updated_at: ticket.updated_at,
        })),
      },
      wishlist_count: wishlistResult.count || 0,
      roles: {
        programRoles: rolesResult.data || [],
        staff_admin: role === 'staff' || role === 'admin' || role === 'superadmin',
      },
      affiliate,
    });
  } catch (error) {
    logDb('me overview', error);
    return errorResponse(res, 'Could not load your account', 500);
  }
}
