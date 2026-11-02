import { Response } from 'express';
import { AuthRequest, staffHasModuleAccess } from '../middleware/auth.middleware';
import {
  CustomerError,
  exportCustomersCsv,
  getCustomer,
  listCustomers,
} from '../services/adminCustomers.service';
import { errorResponse, notFoundResponse, paginatedResponse, successResponse } from '../utils/responseHandlers';

function queryValue(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

function pageLimit(req: AuthRequest) {
  const page = Math.max(1, parseInt(queryValue(req.query.page) || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(queryValue(req.query.limit) || '20', 10) || 20));
  return { page, limit };
}

async function permissions(req: AuthRequest) {
  if (req.user?.role === 'admin' || req.user?.role === 'superadmin') {
    return { affiliates: true, vlb: true };
  }
  const [affiliates, vlb] = await Promise.all([
    staffHasModuleAccess(req, 'affiliates', 'view'),
    staffHasModuleAccess(req, 'vlb', 'view'),
  ]);
  return { affiliates, vlb };
}

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof CustomerError) {
    if (error.statusCode === 404) return notFoundResponse(res, error.message);
    return errorResponse(res, error.message, error.statusCode, null, error.code);
  }
  console.error(fallback, error);
  return errorResponse(res, fallback, 500);
}

function filters(req: AuthRequest) {
  return {
    type: queryValue(req.query.type) || undefined,
    affiliateStatus: queryValue(req.query.affiliate_status) || undefined,
    investorStatus: queryValue(req.query.investor_status) || undefined,
    search: queryValue(req.query.search) || undefined,
    from: queryValue(req.query.from) || undefined,
    to: queryValue(req.query.to) || undefined,
    sort: queryValue(req.query.sort) || undefined,
  };
}

export async function adminListCustomers(req: AuthRequest, res: Response) {
  try {
    const { page, limit } = pageLimit(req);
    const can = await permissions(req);
    const data = await listCustomers({ page, limit, ...filters(req), permissions: can });
    return paginatedResponse(
      res,
      data.rows,
      {
        page,
        limit,
        total: data.total,
        totalPages: Math.max(1, Math.ceil(data.total / limit) || 1),
      },
      'Success',
      { counts: data.counts }
    );
  } catch (error) {
    return fail(res, error, 'Could not load customers.');
  }
}

export async function adminGetCustomer(req: AuthRequest, res: Response) {
  try {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return notFoundResponse(res, 'Customer not found.');
    }
    const can = await permissions(req);
    const data = await getCustomer(id, can);
    return successResponse(res, data);
  } catch (error) {
    return fail(res, error, 'Could not load this customer.');
  }
}

export async function adminExportCustomers(req: AuthRequest, res: Response) {
  try {
    const can = await permissions(req);
    const csv = await exportCustomersCsv({ ...filters(req), permissions: can });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
    return res.status(200).send(csv);
  } catch (error) {
    return fail(res, error, 'Could not export this file.');
  }
}
