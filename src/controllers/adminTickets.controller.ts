import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';
import { logAudit } from '../services/audit.service';
import { warrantyStatus } from '../services/device.service';
import {
  cleanupOrphanUploads,
  displayName,
  emailPaymentReceipt,
  emailStaffReply,
  emailStatusChanged,
  formatTicketGhs,
  insertTicketEvent,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  presentRepairReceipt,
  signedMedia,
  statusMove,
  storeContact,
  STATUS_LABEL,
  TICKET_STATUSES,
  TicketStatus,
  userEmail,
} from '../services/ticket.service';
import pdfService from '../services/pdf.service';
import { supabaseAdmin } from '../utils/supabaseClient';
import { errorResponse, paginatedResponse, successResponse } from '../utils/responseHandlers';

const WARRANTY = ['active', 'expired', 'none', 'unknown'] as const;

const statusSchema = z.object({
  to_status: z.enum(TICKET_STATUSES),
  note: z.string().trim().min(1).max(2000).optional(),
  closed_reason: z.string().trim().min(1).max(500).optional(),
});

const bodySchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

const assignSchema = z.object({
  user_id: z.uuid().nullable(),
});

const patchSchema = z.object({
  is_warranty: z.boolean().nullable().optional(),
  resolution: z.string().trim().max(5000).nullable().optional(),
  repair_cost: z.number().min(0).max(99999999.99).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

const paymentSchema = z.object({
  amount: z.number().min(0).max(99999999.99),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional(),
}).superRefine((value, ctx) => {
  if (value.method !== 'cash' && !value.reference) {
    ctx.addIssue({ code: 'custom', message: 'A reference is required for this payment method.', path: ['reference'] });
  }
});

const issueSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sort_order: z.number().int().min(0).max(10000).optional(),
  is_active: z.boolean().optional(),
});

const issueUpdateSchema = issueSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'Nothing to update',
});

const LIST_SELECT = `
  id, ticket_no, user_id, contact_name, contact_phone, laptop_model, serial_number,
  status, assigned_to, is_warranty, warranty_status_at_submit, created_at, updated_at,
  issue_type:ticket_issue_types!service_tickets_issue_type_id_fkey(id, name),
  customer:users!service_tickets_user_id_fkey(id, full_name, first_name, last_name, email)
`;

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function queryValue(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function logDb(scope: string, error: unknown) {
  console.error(scope, error);
}

function searchTerm(raw: string): string {
  return raw.replace(/[%_\\",()]/g, '').trim().slice(0, 80);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dbCode(error: unknown): string {
  return (error as { code?: string })?.code || '';
}

function presentListRow(row: Record<string, any>) {
  const customer = one(row.customer);
  const issue = one(row.issue_type);
  return {
    id: row.id,
    ticket_no: row.ticket_no,
    status: row.status,
    laptop_model: row.laptop_model,
    serial_number: row.serial_number,
    contact_phone: row.contact_phone,
    assigned_to: row.assigned_to,
    is_warranty: row.is_warranty,
    warranty_status_at_submit: row.warranty_status_at_submit,
    created_at: row.created_at,
    updated_at: row.updated_at,
    issue: issue ? { id: issue.id, name: issue.name } : null,
    customer: {
      name: displayName(customer) || row.contact_name,
      email: customer?.email || null,
    },
  };
}

async function canAssign(userId: string): Promise<boolean> {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'superadmin') return true;
  if (user.role !== 'staff') return false;
  const { data: permission, error: permissionError } = await supabaseAdmin
    .from('staff_permissions')
    .select('can_view, can_edit')
    .eq('user_id', userId)
    .eq('module', 'tickets')
    .maybeSingle();
  if (permissionError) throw permissionError;
  return permission?.can_view === true || permission?.can_edit === true;
}

export async function listTickets(req: AuthRequest, res: Response) {
  try {
    const page = Math.max(1, parseInt(queryValue(req.query.page) || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(queryValue(req.query.limit) || '20', 10) || 20));
    const status = queryValue(req.query.status);
    const issueTypeId = queryValue(req.query.issue_type_id);
    const assignedTo = queryValue(req.query.assigned_to);
    const warranty = queryValue(req.query.warranty_status);
    const from = queryValue(req.query.from);
    const to = queryValue(req.query.to);
    const term = searchTerm(queryValue(req.query.search));

    if (status && status !== 'open' && status !== 'done' && !TICKET_STATUSES.includes(status as TicketStatus)) {
      return errorResponse(res, 'That status is not available.', 400);
    }
    if (issueTypeId && !z.uuid().safeParse(issueTypeId).success) {
      return errorResponse(res, 'Invalid issue type', 400);
    }
    if (assignedTo && assignedTo !== 'unassigned' && !z.uuid().safeParse(assignedTo).success) {
      return errorResponse(res, 'Invalid assignee', 400);
    }
    if (warranty && !WARRANTY.includes(warranty as (typeof WARRANTY)[number])) {
      return errorResponse(res, 'Warranty status must be active, expired, none, or unknown.', 400);
    }
    if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) {
      return errorResponse(res, 'Enter a real date range.', 400);
    }

    let customerIds: string[] = [];
    if (term) {
      const { data: customers, error: customerError } = await supabaseAdmin
        .from('users')
        .select('id')
        .ilike('email', `%${term}%`)
        .limit(50);
      if (customerError) {
        logDb('list tickets customer search', customerError);
        return errorResponse(res, 'Failed to load tickets', 500);
      }
      customerIds = (customers || []).map((customer) => customer.id);
    }

    let query = supabaseAdmin
      .from('service_tickets')
      .select(LIST_SELECT, { count: 'exact' })
      .order('created_at', { ascending: false });
    if (status === 'open') {
      query = query.in('status', ['submitted', 'under_review', 'diagnosing', 'repair_resolution', 'ready']);
    } else if (status === 'done') {
      query = query.in('status', ['completed', 'closed']);
    } else if (status) query = query.eq('status', status);
    if (issueTypeId) query = query.eq('issue_type_id', issueTypeId);
    if (assignedTo === 'unassigned') query = query.is('assigned_to', null);
    else if (assignedTo) query = query.eq('assigned_to', assignedTo);
    if (warranty) query = query.eq('warranty_status_at_submit', warranty);
    if (from) query = query.gte('created_at', `${from}T00:00:00.000Z`);
    if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`);
    if (term) {
      const parts = [
        `ticket_no.ilike."%${term}%"`,
        `serial_number.ilike."%${term}%"`,
        `contact_phone.ilike."%${term}%"`,
      ];
      if (customerIds.length) parts.push(`user_id.in.(${customerIds.join(',')})`);
      query = query.or(parts.join(','));
    }

    const fromRow = (page - 1) * limit;
    const { data, error, count } = await query.range(fromRow, fromRow + limit - 1);
    if (error) {
      logDb('list tickets', error);
      return errorResponse(res, 'Failed to load tickets', 500);
    }
    const total = count || 0;
    return paginatedResponse(res, ((data || []) as Record<string, any>[]).map(presentListRow), {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    logDb('list tickets', error);
    return errorResponse(res, 'Failed to load tickets', 500);
  }
}

export async function ticketSummary(_req: AuthRequest, res: Response) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const counts = await Promise.all(TICKET_STATUSES.map(async (status) => {
      const { count, error } = await supabaseAdmin
        .from('service_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (error) throw error;
      return [status, count || 0] as const;
    }));
    const { count: older, error: olderError } = await supabaseAdmin
      .from('service_tickets')
      .select('id', { count: 'exact', head: true })
      .in('status', ['submitted', 'under_review', 'diagnosing', 'repair_resolution', 'ready'])
      .lt('created_at', sevenDaysAgo);
    if (olderError) throw olderError;

    const durations: number[] = [];
    for (let start = 0; start < 5000; start += 1000) {
      const { data, error } = await supabaseAdmin
        .from('service_tickets')
        .select('created_at, completed_at')
        .gte('completed_at', since)
        .order('completed_at', { ascending: true })
        .range(start, start + 999);
      if (error) throw error;
      for (const row of data || []) {
        const opened = new Date(row.created_at).getTime();
        const completed = new Date(row.completed_at).getTime();
        if (Number.isFinite(opened) && Number.isFinite(completed) && completed >= opened) {
          durations.push((completed - opened) / 86400000);
        }
      }
      if (!data || data.length < 1000) break;
    }
    const average = durations.length
      ? Math.round((durations.reduce((sum, days) => sum + days, 0) / durations.length) * 10) / 10
      : null;

    return successResponse(res, {
      counts: Object.fromEntries(counts),
      open_older_than_7_days: older || 0,
      average_days_to_complete_90: average,
    });
  } catch (error) {
    logDb('ticket summary', error);
    return errorResponse(res, 'Failed to load the summary', 500);
  }
}

export async function getTicket(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Ticket not found.', 404);
    const { data, error } = await supabaseAdmin
      .from('service_tickets')
      .select(`
        *,
        issue_type:ticket_issue_types!service_tickets_issue_type_id_fkey(id, name),
        customer:users!service_tickets_user_id_fkey(id, full_name, first_name, last_name, email),
        assignee:users!service_tickets_assigned_to_fkey(id, full_name, first_name, last_name, email),
        device:devices!service_tickets_device_id_fkey(id, model_name, serial_number, purchase_date, warranty_months, warranty_start),
        order:orders!service_tickets_order_id_fkey(id, order_number),
        events:ticket_events(id, type, from_status, to_status, body, is_internal, actor_id, actor_role, created_at),
        media:ticket_media(id, kind, mime, size_bytes, r2_key, created_at)
      `)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      logDb('get ticket', error);
      return errorResponse(res, 'Could not load this ticket', 500);
    }
    if (!data) return errorResponse(res, 'Ticket not found.', 404);

    const {
      media: rawMedia,
      events: rawEvents,
      device: rawDevice,
      order: rawOrder,
      customer: rawCustomer,
      assignee: rawAssignee,
      issue_type: rawIssue,
      ...ticket
    } = data;

    const { data: previous, error: previousError } = await supabaseAdmin
      .from('service_tickets')
      .select('ticket_no, status, created_at')
      .eq('user_id', data.user_id)
      .neq('id', data.id)
      .order('created_at', { ascending: false });
    if (previousError) {
      logDb('get ticket history', previousError);
      return errorResponse(res, 'Could not load this ticket', 500);
    }

    let media: Array<Record<string, unknown>> = [];
    try {
      media = await signedMedia((rawMedia || []).slice().sort((a: { created_at: string }, b: { created_at: string }) => String(a.created_at).localeCompare(String(b.created_at))));
    } catch (signError) {
      logDb('get ticket media', signError);
      return errorResponse(res, 'Could not load this ticket', 500);
    }

    const device = one(rawDevice);
    const customer = one(rawCustomer);
    const assignee = one(rawAssignee);
    return successResponse(res, {
      ...ticket,
      issue_type: one(rawIssue),
      customer: customer ? { ...customer, name: displayName(customer) } : null,
      assignee: assignee ? { ...assignee, name: displayName(assignee) } : null,
      device: device ? { ...device, warranty: warrantyStatus(device) } : null,
      order: one(rawOrder),
      events: (rawEvents || []).slice().sort((a: { created_at: string }, b: { created_at: string }) => String(a.created_at).localeCompare(String(b.created_at))),
      media,
      previous_tickets: (previous || []).map((row) => ({
        ticket_no: row.ticket_no,
        status: row.status,
        date: String(row.created_at).slice(0, 10),
      })),
    });
  } catch (error) {
    logDb('get ticket', error);
    return errorResponse(res, 'Could not load this ticket', 500);
  }
}

export async function changeStatus(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Ticket not found.', 404);
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, parsed.error.issues[0]?.message || 'Check the form and try again.', 400);

    const { data: before, error: beforeError } = await supabaseAdmin
      .from('service_tickets')
      .select('id, ticket_no, status, user_id, closed_reason, completed_at, last_staff_activity_at')
      .eq('id', id)
      .maybeSingle();
    if (beforeError) {
      logDb('ticket status lookup', beforeError);
      return errorResponse(res, 'Could not update the status', 500);
    }
    if (!before) return errorResponse(res, 'Ticket not found.', 404);

    const note = parsed.data.note?.trim() || null;
    const closedReason = parsed.data.closed_reason?.trim() || null;
    const move = statusMove(before.status, parsed.data.to_status, note, closedReason);
    if (!move.ok) return errorResponse(res, move.message, 400);

    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      status: parsed.data.to_status,
      last_staff_activity_at: now,
    };
    if (parsed.data.to_status === 'closed') update.closed_reason = closedReason;
    if (parsed.data.to_status === 'completed') update.completed_at = now;
    if (before.status === 'completed' && parsed.data.to_status !== 'completed') update.completed_at = null;

    const { error } = await supabaseAdmin.from('service_tickets').update(update).eq('id', id);
    if (error) {
      logDb('ticket status update', error);
      return errorResponse(res, 'Could not update the status', 500);
    }
    const { error: eventError } = await supabaseAdmin.from('ticket_events').insert({
      ticket_id: id,
      type: 'status',
      from_status: before.status,
      to_status: parsed.data.to_status,
      body: note,
      is_internal: false,
      actor_id: req.user?.id ?? null,
      actor_role: req.user?.role ?? null,
    });
    if (eventError) {
      logDb('ticket status event', eventError);
      await supabaseAdmin.from('service_tickets').update({
        status: before.status,
        closed_reason: before.closed_reason,
        completed_at: before.completed_at,
        last_staff_activity_at: before.last_staff_activity_at,
      }).eq('id', id);
      return errorResponse(res, 'Could not update the status', 500);
    }

    const to = parsed.data.to_status as TicketStatus;
    await emailStatusChanged(await userEmail(before.user_id), before.ticket_no, to, note);
    await logAudit({
      req,
      entity: 'service_ticket',
      entityId: id,
      action: 'status',
      before: { status: before.status },
      after: { status: to, closed_reason: closedReason },
    });
    return successResponse(res, { id, status: to, label: STATUS_LABEL[to] }, 'Status updated.');
  } catch (error) {
    logDb('ticket status', error);
    return errorResponse(res, 'Could not update the status', 500);
  }
}

export async function replyToTicket(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Ticket not found.', 404);
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, 'Enter a reply.', 400);
    const { data: ticket, error } = await supabaseAdmin
      .from('service_tickets')
      .select('id, ticket_no, user_id')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      logDb('ticket reply lookup', error);
      return errorResponse(res, 'Could not send the reply', 500);
    }
    if (!ticket) return errorResponse(res, 'Ticket not found.', 404);

    const now = new Date().toISOString();
    const { error: eventError } = await supabaseAdmin.from('ticket_events').insert({
      ticket_id: id,
      type: 'reply',
      body: parsed.data.body,
      is_internal: false,
      actor_id: req.user?.id ?? null,
      actor_role: req.user?.role ?? null,
    });
    if (eventError) {
      logDb('ticket reply event', eventError);
      return errorResponse(res, 'Could not send the reply', 500);
    }
    const { error: updateError } = await supabaseAdmin
      .from('service_tickets')
      .update({ last_staff_activity_at: now })
      .eq('id', id);
    if (updateError) logDb('ticket reply activity', updateError);
    await emailStaffReply(await userEmail(ticket.user_id), ticket.ticket_no, parsed.data.body);
    await logAudit({
      req,
      entity: 'service_ticket',
      entityId: id,
      action: 'reply',
      after: { ticket_no: ticket.ticket_no },
    });
    return successResponse(res, { id }, 'Reply sent.');
  } catch (error) {
    logDb('ticket reply', error);
    return errorResponse(res, 'Could not send the reply', 500);
  }
}

export async function addNote(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Ticket not found.', 404);
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, 'Enter a note.', 400);
    const { data: ticket, error } = await supabaseAdmin
      .from('service_tickets')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      logDb('ticket note lookup', error);
      return errorResponse(res, 'Could not save the note', 500);
    }
    if (!ticket) return errorResponse(res, 'Ticket not found.', 404);

    const now = new Date().toISOString();
    const { error: eventError } = await supabaseAdmin.from('ticket_events').insert({
      ticket_id: id,
      type: 'note',
      body: parsed.data.body,
      is_internal: true,
      actor_id: req.user?.id ?? null,
      actor_role: req.user?.role ?? null,
    });
    if (eventError) {
      logDb('ticket note event', eventError);
      return errorResponse(res, 'Could not save the note', 500);
    }
    const { error: updateError } = await supabaseAdmin
      .from('service_tickets')
      .update({ last_staff_activity_at: now })
      .eq('id', id);
    if (updateError) logDb('ticket note activity', updateError);
    await logAudit({
      req,
      entity: 'service_ticket',
      entityId: id,
      action: 'note',
    });
    return successResponse(res, { id }, 'Note saved.');
  } catch (error) {
    logDb('ticket note', error);
    return errorResponse(res, 'Could not save the note', 500);
  }
}

export async function assignTicket(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Ticket not found.', 404);
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, 'Choose a staff member.', 400);

    const { data: before, error } = await supabaseAdmin
      .from('service_tickets')
      .select('id, assigned_to')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      logDb('ticket assign lookup', error);
      return errorResponse(res, 'Could not assign this ticket', 500);
    }
    if (!before) return errorResponse(res, 'Ticket not found.', 404);
    if (before.assigned_to === parsed.data.user_id) {
      return successResponse(res, { id, assigned_to: before.assigned_to }, 'Assignee updated.');
    }

    let assigneeName = 'Unassigned';
    if (parsed.data.user_id) {
      const allowed = await canAssign(parsed.data.user_id);
      if (!allowed) return errorResponse(res, 'That person cannot be assigned tickets.', 400);
      const { data: assignee, error: assigneeError } = await supabaseAdmin
        .from('users')
        .select('full_name, first_name, last_name, email')
        .eq('id', parsed.data.user_id)
        .maybeSingle();
      if (assigneeError) {
        logDb('ticket assign user', assigneeError);
        return errorResponse(res, 'Could not assign this ticket', 500);
      }
      assigneeName = displayName(assignee) || assignee?.email || 'Staff';
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from('service_tickets')
      .update({ assigned_to: parsed.data.user_id, last_staff_activity_at: now })
      .eq('id', id);
    if (updateError) {
      logDb('ticket assign update', updateError);
      return errorResponse(res, 'Could not assign this ticket', 500);
    }
    const { error: eventError } = await supabaseAdmin.from('ticket_events').insert({
      ticket_id: id,
      type: 'assigned',
      body: parsed.data.user_id ? `Assigned to ${assigneeName}` : 'Unassigned',
      is_internal: true,
      actor_id: req.user?.id ?? null,
      actor_role: req.user?.role ?? null,
    });
    if (eventError) {
      logDb('ticket assign event', eventError);
      await supabaseAdmin.from('service_tickets').update({ assigned_to: before.assigned_to }).eq('id', id);
      return errorResponse(res, 'Could not assign this ticket', 500);
    }
    await logAudit({
      req,
      entity: 'service_ticket',
      entityId: id,
      action: 'assign',
      before: { assigned_to: before.assigned_to },
      after: { assigned_to: parsed.data.user_id },
    });
    return successResponse(res, { id, assigned_to: parsed.data.user_id }, 'Assignee updated.');
  } catch (error) {
    logDb('ticket assign', error);
    return errorResponse(res, 'Could not assign this ticket', 500);
  }
}

export async function updateTicket(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Ticket not found.', 404);
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, parsed.error.issues[0]?.message || 'Check the form and try again.', 400);

    const { data: before, error } = await supabaseAdmin
      .from('service_tickets')
      .select('id, is_warranty, resolution, repair_cost, repair_paid')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      logDb('ticket update lookup', error);
      return errorResponse(res, 'Could not update this ticket', 500);
    }
    if (!before) return errorResponse(res, 'Ticket not found.', 404);

    const nextResolution = parsed.data.resolution === undefined
      ? before.resolution
      : (parsed.data.resolution?.trim() || null);
    const resolutionChanged = parsed.data.resolution !== undefined && nextResolution !== (before.resolution || null);
    const warrantyChanged = parsed.data.is_warranty !== undefined && parsed.data.is_warranty !== before.is_warranty;
    const nextCost = parsed.data.repair_cost;
    const beforeCost = before.repair_cost === null || before.repair_cost === undefined ? null : Number(before.repair_cost);
    const costChanged = nextCost !== undefined && nextCost !== beforeCost;
    const update: Record<string, unknown> = { last_staff_activity_at: new Date().toISOString() };
    if (parsed.data.is_warranty !== undefined) update.is_warranty = parsed.data.is_warranty;
    if (parsed.data.resolution !== undefined) update.resolution = nextResolution;
    if (parsed.data.repair_cost !== undefined) update.repair_cost = parsed.data.repair_cost;

    const { data, error: updateError } = await supabaseAdmin
      .from('service_tickets')
      .update(update)
      .eq('id', id)
      .select('id, is_warranty, resolution, repair_cost, repair_paid')
      .maybeSingle();
    if (updateError || !data) {
      logDb('ticket update', updateError);
      return errorResponse(res, 'Could not update this ticket', 500);
    }
    const actor = { actor_id: req.user?.id ?? null, actor_role: req.user?.role ?? null };
    const events: Array<{ type: string; body: string | null; is_internal: boolean }> = [];
    if (warrantyChanged && typeof parsed.data.is_warranty === 'boolean') {
      events.push({
        type: 'warranty',
        body: parsed.data.is_warranty ? 'Marked as warranty job' : 'Marked as not a warranty job',
        is_internal: true,
      });
    }
    if (costChanged && typeof nextCost === 'number') {
      events.push({
        type: 'repair_cost',
        body: `Repair cost set to ${formatTicketGhs(nextCost)}`,
        is_internal: true,
      });
    }
    if (resolutionChanged) {
      events.push({
        type: 'resolution',
        body: nextResolution,
        is_internal: false,
      });
    }
    for (const event of events) {
      const wrote = await insertTicketEvent({
        ticket_id: id,
        type: event.type,
        body: event.body,
        is_internal: event.is_internal,
        ...actor,
      });
      if (!wrote) return errorResponse(res, 'Could not update this ticket', 500);
    }
    await logAudit({
      req,
      entity: 'service_ticket',
      entityId: id,
      action: 'update',
      before: {
        is_warranty: before.is_warranty,
        resolution: before.resolution,
        repair_cost: before.repair_cost,
      },
      after: data,
    });
    return successResponse(res, data, 'Ticket updated.');
  } catch (error) {
    logDb('ticket update', error);
    return errorResponse(res, 'Could not update this ticket', 500);
  }
}

export async function recordTicketPayment(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Ticket not found.', 404);
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, parsed.error.issues[0]?.message || 'Check the payment details.', 400);

    const { data: ticket, error } = await supabaseAdmin
      .from('service_tickets')
      .select('id, ticket_no, laptop_model, user_id, repair_paid, repair_paid_at')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      logDb('ticket payment lookup', error);
      return errorResponse(res, 'Could not record this payment', 500);
    }
    if (!ticket) return errorResponse(res, 'Ticket not found.', 404);
    if (ticket.repair_paid || ticket.repair_paid_at) {
      return errorResponse(res, 'Payment has already been recorded.', 409);
    }

    const now = new Date().toISOString();
    const reference = parsed.data.method === 'cash' ? (parsed.data.reference || null) : parsed.data.reference || null;
    const { data, error: updateError } = await supabaseAdmin
      .from('service_tickets')
      .update({
        repair_paid: true,
        repair_paid_amount: parsed.data.amount,
        repair_paid_method: parsed.data.method,
        repair_paid_reference: reference,
        repair_paid_at: now,
        repair_paid_by: req.user?.id ?? null,
        last_staff_activity_at: now,
      })
      .eq('id', id)
      .eq('repair_paid', false)
      .select('id, ticket_no, laptop_model, repair_paid, repair_paid_amount, repair_paid_method, repair_paid_reference, repair_paid_at')
      .maybeSingle();
    if (updateError) {
      logDb('ticket payment update', updateError);
      return errorResponse(res, 'Could not record this payment', 500);
    }
    if (!data) return errorResponse(res, 'Payment has already been recorded.', 409);

    const methodLabel = PAYMENT_METHOD_LABEL[parsed.data.method];
    const body = `Payment received: ${formatTicketGhs(parsed.data.amount)} by ${methodLabel}`;
    const wrote = await insertTicketEvent({
      ticket_id: id,
      type: 'payment',
      body,
      is_internal: false,
      actor_id: req.user?.id ?? null,
      actor_role: req.user?.role ?? null,
    });
    if (!wrote) {
      await supabaseAdmin.from('service_tickets').update({
        repair_paid: false,
        repair_paid_amount: null,
        repair_paid_method: null,
        repair_paid_reference: null,
        repair_paid_at: null,
        repair_paid_by: null,
      }).eq('id', id);
      return errorResponse(res, 'Could not record this payment', 500);
    }

    await emailPaymentReceipt({
      to: await userEmail(ticket.user_id),
      ticketNo: ticket.ticket_no,
      laptop: ticket.laptop_model,
      amount: parsed.data.amount,
      method: parsed.data.method,
      reference,
      paidAt: now,
    });
    await logAudit({
      req,
      entity: 'service_ticket',
      entityId: id,
      action: 'payment',
      after: {
        amount: parsed.data.amount,
        method: parsed.data.method,
        reference,
        paid_at: now,
      },
    });
    return successResponse(res, data, 'Payment recorded.');
  } catch (error) {
    logDb('ticket payment', error);
    return errorResponse(res, 'Could not record this payment', 500);
  }
}

export async function getTicketReceipt(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Ticket not found.', 404);
    const { data: ticket, error } = await supabaseAdmin
      .from('service_tickets')
      .select('ticket_no, laptop_model, repair_paid, repair_paid_amount, repair_paid_method, repair_paid_reference, repair_paid_at')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      logDb('ticket receipt', error);
      return errorResponse(res, 'Could not load this receipt', 500);
    }
    if (!ticket) return errorResponse(res, 'Ticket not found.', 404);
    if (!ticket.repair_paid || !ticket.repair_paid_at) return errorResponse(res, 'No receipt for this ticket.', 404);

    const contact = await storeContact();
    const payload = presentRepairReceipt(ticket, contact);
    if (String(req.query.format || '') === 'pdf') {
      const pdf = await pdfService.generateTicketReceiptPDF({
        ticket_no: payload.ticket_no,
        laptop_model: payload.laptop_model,
        amount: payload.amount || 0,
        method: payload.method_label || payload.method || '',
        reference: payload.reference,
        paid_at: payload.paid_at || new Date().toISOString(),
        phone: contact.phone,
        email: contact.email,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${ticket.ticket_no}-receipt.pdf"`);
      return res.status(200).send(pdf);
    }
    return successResponse(res, payload);
  } catch (error) {
    logDb('ticket receipt', error);
    return errorResponse(res, 'Could not load this receipt', 500);
  }
}

export async function listAssignees(_req: AuthRequest, res: Response) {
  try {
    const [{ data: leaders, error: leaderError }, { data: permissions, error: permissionError }] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('id, full_name, first_name, last_name, email, role')
        .in('role', ['admin', 'superadmin']),
      supabaseAdmin
        .from('staff_permissions')
        .select('user_id, can_view, can_edit')
        .eq('module', 'tickets'),
    ]);
    if (leaderError || permissionError) {
      logDb('list assignees', leaderError || permissionError);
      return errorResponse(res, 'Failed to load assignees', 500);
    }
    const staffIds = (permissions || [])
      .filter((row) => row.can_view === true || row.can_edit === true)
      .map((row) => row.user_id);
    let staff: Array<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null; email: string | null }> = [];
    if (staffIds.length) {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('id, full_name, first_name, last_name, email, role')
        .in('id', staffIds)
        .eq('role', 'staff');
      if (error) {
        logDb('list assignee staff', error);
        return errorResponse(res, 'Failed to load assignees', 500);
      }
      staff = data || [];
    }
    const people = new Map<string, { id: string; name: string | null; email: string | null }>();
    for (const person of [...(leaders || []), ...staff]) {
      people.set(person.id, {
        id: person.id,
        name: displayName(person),
        email: person.email,
      });
    }
    return successResponse(res, [...people.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
  } catch (error) {
    logDb('list assignees', error);
    return errorResponse(res, 'Failed to load assignees', 500);
  }
}

export async function listIssueTypesAdmin(_req: AuthRequest, res: Response) {
  try {
    const { data, error } = await supabaseAdmin
      .from('ticket_issue_types')
      .select('id, name, sort_order, is_active, created_at, updated_at')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) {
      logDb('list admin issue types', error);
      return errorResponse(res, 'Failed to load issue types', 500);
    }
    return successResponse(res, data || []);
  } catch (error) {
    logDb('list admin issue types', error);
    return errorResponse(res, 'Failed to load issue types', 500);
  }
}

export async function createIssueType(req: AuthRequest, res: Response) {
  try {
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, 'Enter an issue type name.', 400);
    const { data, error } = await supabaseAdmin
      .from('ticket_issue_types')
      .insert({
        name: parsed.data.name,
        sort_order: parsed.data.sort_order ?? 0,
        is_active: parsed.data.is_active ?? true,
      })
      .select('id, name, sort_order, is_active')
      .single();
    if (error || !data) {
      if (dbCode(error) === '23505') return errorResponse(res, 'That issue type already exists.', 409);
      logDb('create issue type', error);
      return errorResponse(res, 'Could not save the issue type', 500);
    }
    await logAudit({
      req,
      entity: 'ticket_issue_type',
      entityId: data.id,
      action: 'create',
      after: data,
    });
    return successResponse(res, data, 'Issue type saved.', 201);
  } catch (error) {
    logDb('create issue type', error);
    return errorResponse(res, 'Could not save the issue type', 500);
  }
}

export async function updateIssueType(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) return errorResponse(res, 'Issue type not found.', 404);
    const parsed = issueUpdateSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(res, parsed.error.issues[0]?.message || 'Check the form and try again.', 400);
    const { data: before, error: beforeError } = await supabaseAdmin
      .from('ticket_issue_types')
      .select('id, name, sort_order, is_active')
      .eq('id', id)
      .maybeSingle();
    if (beforeError) {
      logDb('update issue type lookup', beforeError);
      return errorResponse(res, 'Could not save the issue type', 500);
    }
    if (!before) return errorResponse(res, 'Issue type not found.', 404);

    const { data, error } = await supabaseAdmin
      .from('ticket_issue_types')
      .update(parsed.data)
      .eq('id', id)
      .select('id, name, sort_order, is_active')
      .maybeSingle();
    if (error || !data) {
      if (dbCode(error) === '23505') return errorResponse(res, 'That issue type already exists.', 409);
      logDb('update issue type', error);
      return errorResponse(res, 'Could not save the issue type', 500);
    }
    await logAudit({
      req,
      entity: 'ticket_issue_type',
      entityId: id,
      action: 'update',
      before,
      after: data,
    });
    return successResponse(res, data, 'Issue type saved.');
  } catch (error) {
    logDb('update issue type', error);
    return errorResponse(res, 'Could not save the issue type', 500);
  }
}

export async function cleanupUploads(req: AuthRequest, res: Response) {
  try {
    const deleted = await cleanupOrphanUploads();
    await logAudit({
      req,
      entity: 'service_ticket',
      entityId: null,
      action: 'cleanup-uploads',
      after: { deleted },
    });
    return successResponse(res, { deleted }, 'Old uploads removed.');
  } catch (error) {
    logDb('cleanup uploads', error);
    return errorResponse(res, 'Could not remove old uploads', 500);
  }
}
