import { Request, Response } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { errorResponse, paginatedResponse } from '../utils/responseHandlers';

export const listAuditLog = async (req: Request, res: Response) => {
  try {
    const pageNum = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limitNum = Math.min(
      Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1),
      100
    );
    const offset = (pageNum - 1) * limitNum;

    const entity = typeof req.query.entity === 'string' ? req.query.entity : undefined;
    const entityId = typeof req.query.entity_id === 'string' ? req.query.entity_id : undefined;
    const actorId = typeof req.query.actor_id === 'string' ? req.query.actor_id : undefined;
    const dateFrom = typeof req.query.date_from === 'string' ? req.query.date_from : undefined;
    const dateTo = typeof req.query.date_to === 'string' ? req.query.date_to : undefined;

    if ((dateFrom && Number.isNaN(Date.parse(dateFrom))) || (dateTo && Number.isNaN(Date.parse(dateTo)))) {
      return errorResponse(res, 'date_from and date_to must be valid dates', 400);
    }

    let query = supabaseAdmin
      .from('audit_log')
      .select('*', { count: 'exact' });

    if (entity) query = query.eq('entity', entity);
    if (entityId) query = query.eq('entity_id', entityId);
    if (actorId) query = query.eq('actor_id', actorId);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) throw error;

    const total = count || 0;
    return paginatedResponse(res, data || [], {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error('Error fetching audit log:', error instanceof Error ? error.message : error);
    return errorResponse(res, 'Failed to fetch audit log', 500);
  }
};
