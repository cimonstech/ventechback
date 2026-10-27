import { randomUUID } from 'crypto';
import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';
import { logAudit } from '../services/audit.service';
import { warrantyStatus } from '../services/device.service';
import { deletePrivateObject, getSignedViewUrl, putPrivateObject } from '../services/privateStorage.service';
import { detectTicketFile, uploadKind } from '../services/ticketFiles';
import {
  emailAdminNewTicket,
  emailCustomerMessage,
  emailTicketReceived,
  signedMedia,
} from '../services/ticket.service';
import { supabaseAdmin } from '../utils/supabaseClient';
import { errorResponse, successResponse } from '../utils/responseHandlers';

const createSchema = z.object({
  device_token: z.string().trim().max(80).optional(),
  order_number: z.string().trim().max(40).optional(),
  issue_type_id: z.uuid(),
  contact_name: z.string().trim().min(1).max(120),
  contact_phone: z.string().trim().min(1).max(40),
  laptop_model: z.string().trim().max(200).optional(),
  serial_number: z.string().trim().max(200).optional(),
  date_started: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(20, 'Describe the problem in at least 20 characters.').max(3000, 'Description must be 3000 characters or less.'),
  media_ids: z.array(z.uuid()).max(5).optional(),
});

const messageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

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

function formMessage(error: z.ZodError): string {
  const message = error.issues[0]?.message || '';
  if (!message || /invalid|expected|received/i.test(message)) return 'Check the form and try again.';
  return message;
}

function isRealDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function rollbackTicket(ticketId: string) {
  const { error: mediaError } = await supabaseAdmin
    .from('ticket_media')
    .update({ ticket_id: null })
    .eq('ticket_id', ticketId);
  if (mediaError) logDb('rollback ticket media', mediaError);
  const { error: eventError } = await supabaseAdmin.from('ticket_events').delete().eq('ticket_id', ticketId);
  if (eventError) logDb('rollback ticket events', eventError);
  const { error: ticketError } = await supabaseAdmin.from('service_tickets').delete().eq('id', ticketId);
  if (ticketError) logDb('rollback ticket', ticketError);
}

export async function listIssueTypes(_req: AuthRequest, res: Response) {
  try {
    const { data, error } = await supabaseAdmin
      .from('ticket_issue_types')
      .select('id, name, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) {
      logDb('list issue types', error);
      return errorResponse(res, 'Failed to load issue types', 500);
    }
    return successResponse(res, data || []);
  } catch (error) {
    logDb('list issue types', error);
    return errorResponse(res, 'Failed to load issue types', 500);
  }
}

export async function createUpload(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return errorResponse(res, 'Unauthorized', 401);
    const file = req.file;
    if (!file?.buffer?.length) return errorResponse(res, 'Choose a file.', 400);

    const detected = detectTicketFile(file.buffer);
    if (!detected) return errorResponse(res, 'This file type is not supported.', 400);
    const requestedKind = typeof req.body?.kind === 'string' ? req.body.kind.trim() : '';
    const decided = uploadKind(detected, requestedKind, file.size);
    if ('error' in decided) return errorResponse(res, decided.error, 400);

    const key = `tickets/${userId}/${randomUUID()}.${detected.ext}`;
    try {
      await putPrivateObject(key, file.buffer, detected.mime);
    } catch (error) {
      logDb('ticket upload store', error);
      return errorResponse(res, 'Could not store this file', 500);
    }

    const { data, error } = await supabaseAdmin
      .from('ticket_media')
      .insert({
        ticket_id: null,
        user_id: userId,
        r2_key: key,
        mime: detected.mime,
        size_bytes: file.size,
        kind: decided.kind,
      })
      .select('id, kind, size_bytes, r2_key')
      .single();
    if (error || !data) {
      logDb('ticket upload insert', error);
      try {
        await deletePrivateObject(key);
      } catch (deleteError) {
        logDb('ticket upload cleanup', deleteError);
      }
      return errorResponse(res, 'Could not store this file', 500);
    }

    try {
      const previewUrl = await getSignedViewUrl(data.r2_key, 600);
      return successResponse(res, {
        id: data.id,
        kind: data.kind,
        size_bytes: data.size_bytes,
        previewUrl,
      }, 'File uploaded.', 201);
    } catch (error) {
      logDb('ticket upload sign', error);
      await supabaseAdmin.from('ticket_media').delete().eq('id', data.id).eq('user_id', userId);
      try {
        await deletePrivateObject(key);
      } catch (deleteError) {
        logDb('ticket upload cleanup', deleteError);
      }
      return errorResponse(res, 'Could not store this file', 500);
    }
  } catch (error) {
    logDb('ticket upload', error);
    return errorResponse(res, 'Could not store this file', 500);
  }
}

export async function deleteUpload(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return errorResponse(res, 'Unauthorized', 401);
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Upload not found.', 404);

    const { data, error } = await supabaseAdmin
      .from('ticket_media')
      .select('id, r2_key')
      .eq('id', id)
      .eq('user_id', userId)
      .is('ticket_id', null)
      .maybeSingle();
    if (error) {
      logDb('delete ticket upload lookup', error);
      return errorResponse(res, 'Could not delete this file', 500);
    }
    if (!data) return errorResponse(res, 'Upload not found.', 404);

    try {
      await deletePrivateObject(data.r2_key);
    } catch (objectError) {
      logDb('delete ticket upload object', objectError);
      return errorResponse(res, 'Could not delete this file', 500);
    }

    const { error: deleteError } = await supabaseAdmin
      .from('ticket_media')
      .delete()
      .eq('id', data.id)
      .eq('user_id', userId)
      .is('ticket_id', null);
    if (deleteError) {
      logDb('delete ticket upload row', deleteError);
      return errorResponse(res, 'Could not delete this file', 500);
    }
    return successResponse(res, { id: data.id }, 'File deleted.');
  } catch (error) {
    logDb('delete ticket upload', error);
    return errorResponse(res, 'Could not delete this file', 500);
  }
}

export async function createTicket(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return errorResponse(res, 'Unauthorized', 401);
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const body = parsed.data;
    if (!isRealDate(body.date_started)) return errorResponse(res, 'Enter a real start date.', 400);
    if (body.date_started > new Date().toISOString().slice(0, 10)) {
      return errorResponse(res, 'The start date cannot be in the future.', 400);
    }

    const mediaIds = body.media_ids || [];
    if (new Set(mediaIds).size !== mediaIds.length) {
      return errorResponse(res, 'Each file can only be attached once.', 400);
    }

    const { data: issue, error: issueError } = await supabaseAdmin
      .from('ticket_issue_types')
      .select('id, name')
      .eq('id', body.issue_type_id)
      .eq('is_active', true)
      .maybeSingle();
    if (issueError) {
      logDb('create ticket issue', issueError);
      return errorResponse(res, 'Could not submit this request', 500);
    }
    if (!issue) return errorResponse(res, 'Choose an issue type.', 400);

    let media: Array<{ id: string; kind: string }> = [];
    if (mediaIds.length) {
      const { data, error } = await supabaseAdmin
        .from('ticket_media')
        .select('id, kind, user_id, ticket_id')
        .in('id', mediaIds);
      if (error) {
        logDb('create ticket media', error);
        return errorResponse(res, 'Could not submit this request', 500);
      }
      const byId = new Map((data || []).map((row) => [row.id, row]));
      const rows = mediaIds.map((id) => byId.get(id));
      if (rows.some((row) => !row || row.user_id !== userId || row.ticket_id)) {
        return errorResponse(res, 'One of those files is no longer available.', 400);
      }
      media = rows.map((row) => ({ id: row!.id, kind: row!.kind }));
      if (media.filter((row) => row.kind === 'video').length > 1) {
        return errorResponse(res, 'Only one video can be attached.', 400);
      }
    }

    const token = body.device_token?.trim() || '';
    let deviceId: string | null = null;
    let orderId: string | null = null;
    let laptopModel = body.laptop_model?.trim() || '';
    let serialNumber = body.serial_number?.trim() || null;
    let orderNumberText: string | null = null;
    let warranty: 'active' | 'expired' | 'none' | 'unknown' = 'unknown';

    if (token) {
      const { data: device, error: deviceError } = await supabaseAdmin
        .from('devices')
        .select('id, user_id, order_id, model_name, serial_number, warranty_months, warranty_start')
        .eq('qr_token', token)
        .maybeSingle();
      if (deviceError) {
        logDb('create ticket device', deviceError);
        return errorResponse(res, 'Could not submit this request', 500);
      }
      if (!device || device.user_id !== userId) return errorResponse(res, 'Device not found.', 404);
      deviceId = device.id;
      orderId = device.order_id;
      laptopModel = device.model_name;
      serialNumber = device.serial_number;
      warranty = warrantyStatus(device).status;
    } else {
      if (!laptopModel) return errorResponse(res, 'Enter the laptop model.', 400);
      const orderNumber = body.order_number?.trim() || '';
      const hasReceipt = media.some((row) => row.kind === 'receipt');
      if (!orderNumber && !hasReceipt) {
        return errorResponse(res, 'Add an order number or a receipt.', 400);
      }
      if (orderNumber) {
        const { data: order, error: orderError } = await supabaseAdmin
          .from('orders')
          .select('id')
          .eq('order_number', orderNumber)
          .eq('user_id', userId)
          .maybeSingle();
        if (orderError) {
          logDb('create ticket order', orderError);
          return errorResponse(res, 'Could not submit this request', 500);
        }
        if (order) orderId = order.id;
        else orderNumberText = orderNumber;
      }
    }

    const now = new Date().toISOString();
    const { data: ticket, error: insertError } = await supabaseAdmin
      .from('service_tickets')
      .insert({
        user_id: userId,
        device_id: deviceId,
        order_id: orderId,
        order_number_text: orderNumberText,
        issue_type_id: issue.id,
        contact_name: body.contact_name,
        contact_phone: body.contact_phone,
        laptop_model: laptopModel,
        serial_number: serialNumber,
        date_started: body.date_started,
        description: body.description,
        status: 'submitted',
        warranty_status_at_submit: warranty,
        last_customer_activity_at: now,
      })
      .select('id, ticket_no')
      .single();
    if (insertError || !ticket) {
      logDb('create ticket', insertError);
      return errorResponse(res, 'Could not submit this request', 500);
    }

    if (media.length) {
      const { data: attached, error: attachError } = await supabaseAdmin
        .from('ticket_media')
        .update({ ticket_id: ticket.id })
        .in('id', media.map((row) => row.id))
        .eq('user_id', userId)
        .is('ticket_id', null)
        .select('id');
      if (attachError || (attached || []).length !== media.length) {
        logDb('create ticket attach', attachError);
        await rollbackTicket(ticket.id);
        return errorResponse(res, 'One of those files is no longer available.', 400);
      }
    }

    const { error: eventError } = await supabaseAdmin.from('ticket_events').insert({
      ticket_id: ticket.id,
      type: 'created',
      body: body.description,
      is_internal: false,
      actor_id: userId,
      actor_role: req.user?.role || 'customer',
    });
    if (eventError) {
      logDb('create ticket event', eventError);
      await rollbackTicket(ticket.id);
      return errorResponse(res, 'Could not submit this request', 500);
    }

    await emailTicketReceived(req.user?.email || '', ticket.ticket_no);
    await emailAdminNewTicket({
      ticketId: ticket.id,
      ticketNo: ticket.ticket_no,
      issue: issue.name,
      model: laptopModel,
    });
    await logAudit({
      req,
      entity: 'service_ticket',
      entityId: ticket.id,
      action: 'create',
      after: { ticket_no: ticket.ticket_no, status: 'submitted' },
    });

    return successResponse(res, {
      id: ticket.id,
      ticket_no: ticket.ticket_no,
      status: 'submitted',
    }, 'Service request submitted.', 201);
  } catch (error) {
    logDb('create ticket', error);
    return errorResponse(res, 'Could not submit this request', 500);
  }
}

export async function listMine(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return errorResponse(res, 'Unauthorized', 401);
    const { data, error } = await supabaseAdmin
      .from('service_tickets')
      .select('ticket_no, laptop_model, status, updated_at, issue_type:ticket_issue_types!service_tickets_issue_type_id_fkey(name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      logDb('list my tickets', error);
      return errorResponse(res, 'Failed to load your requests', 500);
    }
    const tickets = (data || []).map((row) => ({
      ticket_no: row.ticket_no,
      model: row.laptop_model,
      issue: one(row.issue_type)?.name || '',
      status: row.status,
      updated_at: row.updated_at,
    }));
    return successResponse(res, tickets);
  } catch (error) {
    logDb('list my tickets', error);
    return errorResponse(res, 'Failed to load your requests', 500);
  }
}

export async function getMine(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return errorResponse(res, 'Unauthorized', 401);
    const ticketNo = param(req.params.ticketNo).trim();
    const { data, error } = await supabaseAdmin
      .from('service_tickets')
      .select(`
        id, ticket_no, status, laptop_model, serial_number, description, date_started,
        contact_name, contact_phone, warranty_status_at_submit, is_warranty,
        resolution, repair_cost, repair_paid, order_number_text, created_at, updated_at,
        completed_at, closed_reason,
        issue_type:ticket_issue_types!service_tickets_issue_type_id_fkey(id, name),
        order:orders!service_tickets_order_id_fkey(order_number),
        events:ticket_events(id, type, from_status, to_status, body, is_internal, actor_role, created_at),
        media:ticket_media(id, kind, mime, size_bytes, r2_key, created_at)
      `)
      .eq('user_id', userId)
      .eq('ticket_no', ticketNo)
      .maybeSingle();
    if (error) {
      logDb('get my ticket', error);
      return errorResponse(res, 'Could not load this request', 500);
    }
    if (!data) return errorResponse(res, 'Ticket not found.', 404);

    const events = (data.events || [])
      .filter((event) => event.is_internal === false)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map(({ is_internal: _internal, ...event }) => event);
    let media: Array<Record<string, unknown>> = [];
    try {
      const signed = await signedMedia((data.media || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
      media = signed.map(({ created_at: _created, ...row }) => row);
    } catch (signError) {
      logDb('get my ticket media', signError);
      return errorResponse(res, 'Could not load this request', 500);
    }

    const order = one(data.order);
    return successResponse(res, {
      ticket_no: data.ticket_no,
      status: data.status,
      laptop_model: data.laptop_model,
      serial_number: data.serial_number,
      description: data.description,
      date_started: data.date_started,
      contact_name: data.contact_name,
      contact_phone: data.contact_phone,
      issue: one(data.issue_type),
      warranty_status_at_submit: data.warranty_status_at_submit,
      is_warranty: data.is_warranty,
      resolution: data.resolution,
      repair_cost: data.repair_cost,
      repair_paid: data.repair_paid,
      order_number: order?.order_number || data.order_number_text,
      created_at: data.created_at,
      updated_at: data.updated_at,
      completed_at: data.completed_at,
      closed_reason: data.closed_reason,
      events,
      media,
    });
  } catch (error) {
    logDb('get my ticket', error);
    return errorResponse(res, 'Could not load this request', 500);
  }
}

export async function postMessage(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return errorResponse(res, 'Unauthorized', 401);
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, formMessage(parsed.error), 400);
    const ticketNo = param(req.params.ticketNo).trim();

    const { data: ticket, error } = await supabaseAdmin
      .from('service_tickets')
      .select('id, ticket_no, status, user_id')
      .eq('user_id', userId)
      .eq('ticket_no', ticketNo)
      .maybeSingle();
    if (error) {
      logDb('ticket message lookup', error);
      return errorResponse(res, 'Could not send this message', 500);
    }
    if (!ticket) return errorResponse(res, 'Ticket not found.', 404);
    if (ticket.status === 'completed' || ticket.status === 'closed') {
      return errorResponse(res, 'This request is closed. Please open a new one.', 400);
    }

    const now = new Date().toISOString();
    const { error: eventError } = await supabaseAdmin.from('ticket_events').insert({
      ticket_id: ticket.id,
      type: 'reply',
      body: parsed.data.body,
      is_internal: false,
      actor_id: userId,
      actor_role: req.user?.role || 'customer',
    });
    if (eventError) {
      logDb('ticket message event', eventError);
      return errorResponse(res, 'Could not send this message', 500);
    }
    const { error: updateError } = await supabaseAdmin
      .from('service_tickets')
      .update({ last_customer_activity_at: now })
      .eq('id', ticket.id)
      .eq('user_id', userId);
    if (updateError) logDb('ticket message activity', updateError);

    await emailCustomerMessage({
      ticketId: ticket.id,
      ticketNo: ticket.ticket_no,
      body: parsed.data.body,
    });
    await logAudit({
      req,
      entity: 'service_ticket',
      entityId: ticket.id,
      action: 'reply',
      after: { ticket_no: ticket.ticket_no },
    });
    return successResponse(res, { ticket_no: ticket.ticket_no }, 'Message sent.');
  } catch (error) {
    logDb('ticket message', error);
    return errorResponse(res, 'Could not send this message', 500);
  }
}
