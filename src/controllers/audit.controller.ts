import { Response } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { AuthRequest } from '../middleware/auth.middleware';
import { errorResponse, paginatedResponse } from '../utils/responseHandlers';
import {
  applyHiddenSuperadminAuditFilter,
  getSuperadminIds,
  isSuperadmin,
} from '../services/superadmin.service';

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function auditCsv(rows: Array<Record<string, unknown>>): string {
  const header = ['created_at', 'actor_role', 'action', 'entity', 'entity_id'];
  const lines = rows.map((row) => header.map((key) => csvCell(row[key])).join(','));
  return [header.join(','), ...lines].join('\n');
}

function applyFilters(query: any, req: AuthRequest) {
  const entity = typeof req.query.entity === 'string' ? req.query.entity : undefined;
  const entityId = typeof req.query.entity_id === 'string' ? req.query.entity_id : undefined;
  const actorId = typeof req.query.actor_id === 'string' ? req.query.actor_id : undefined;
  const dateFrom = typeof req.query.date_from === 'string' ? req.query.date_from : undefined;
  const dateTo = typeof req.query.date_to === 'string' ? req.query.date_to : undefined;

  if (entity) query = query.eq('entity', entity);
  if (entityId) query = query.eq('entity_id', entityId);
  if (actorId) query = query.eq('actor_id', actorId);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo);
  return query;
}

export const listAuditLog = async (req: AuthRequest, res: Response) => {
  try {
    const pageNum = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limitNum = Math.min(
      Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1),
      100
    );
    const offset = (pageNum - 1) * limitNum;
    const asCsv = String(req.query.format || '') === 'csv';

    const dateFrom = typeof req.query.date_from === 'string' ? req.query.date_from : undefined;
    const dateTo = typeof req.query.date_to === 'string' ? req.query.date_to : undefined;
    if ((dateFrom && Number.isNaN(Date.parse(dateFrom))) || (dateTo && Number.isNaN(Date.parse(dateTo)))) {
      return errorResponse(res, 'date_from and date_to must be valid dates', 400);
    }

    const hideSuperadmin = !isSuperadmin(req.user);
    const superadminIds = hideSuperadmin ? await getSuperadminIds() : [];

    const build = () => {
      let query = supabaseAdmin.from('audit_log').select('*', { count: 'exact' });
      query = applyFilters(query, req);
      if (hideSuperadmin) query = applyHiddenSuperadminAuditFilter(query, superadminIds);
      return query;
    };

    if (asCsv) {
      const rows: Array<Record<string, unknown>> = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await build()
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...((data || []) as Array<Record<string, unknown>>));
        if (!data || data.length < pageSize) break;
      }
      const csv = auditCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
      return res.status(200).send(csv);
    }

    const { data, error, count } = await build()
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) throw error;

    const total = count || 0;
    return paginatedResponse(res, data || [], {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  } catch (error) {
    console.error('Error fetching audit log:', error instanceof Error ? error.message : error);
    return errorResponse(res, 'Failed to fetch audit log', 500);
  }
};
