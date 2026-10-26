import { Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../utils/supabaseClient';
import { AuthRequest } from '../middleware/auth.middleware';
import { errorResponse, successResponse } from '../utils/responseHandlers';
import { logAudit } from '../services/audit.service';
import { sanitizeContentHtml } from '../services/sanitize.service';

const ARTICLE_TYPES = [
  'user_guide',
  'maintenance',
  'troubleshooting',
  'hardware',
  'software',
  'warranty',
] as const;

const STATUSES = ['draft', 'published'] as const;
const TARGET_TYPES = ['all', 'brand', 'category', 'product'] as const;
const PAGE_SLUGS = [
  'terms',
  'privacy',
  'returns',
  'shipping',
  'affiliate-terms',
  'laptop-banking-terms',
] as const;

const targetSchema = z.object({
  target_type: z.enum(TARGET_TYPES),
  target_id: z.uuid().nullable().optional(),
}).superRefine((target, ctx) => {
  if (target.target_type === 'all' && target.target_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'An all target cannot have a target id',
      path: ['target_id'],
    });
  }
  if (target.target_type !== 'all' && !target.target_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A target id is required',
      path: ['target_id'],
    });
  }
});

const targetsSchema = z.array(targetSchema).superRefine((targets, ctx) => {
  const seen = new Set<string>();
  targets.forEach((target, index) => {
    const key = `${target.target_type}:${target.target_id || ''}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate target',
        path: [index],
      });
    }
    seen.add(key);
  });
});

const articleSchema = z.object({
  type: z.enum(ARTICLE_TYPES),
  title: z.string().trim().min(1).max(300),
  slug: z.string().trim().max(200).optional().or(z.literal('')),
  summary: z.string().trim().max(1000).nullable().optional(),
  body_html: z.string().optional().default(''),
  attachment_url: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  sort_order: z.number().int().optional(),
  targets: targetsSchema.optional().default([]),
});

const articleUpdateSchema = z.object({
  type: z.enum(ARTICLE_TYPES).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  slug: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  body_html: z.string().optional(),
  attachment_url: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  sort_order: z.number().int().optional(),
  targets: targetsSchema.optional(),
});

const categorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

const faqSchema = z.object({
  category_id: z.uuid(),
  question: z.string().trim().min(1).max(500),
  answer_html: z.string().min(1),
  status: z.enum(STATUSES).optional(),
  sort_order: z.number().int().optional(),
});

const faqUpdateSchema = faqSchema.partial();

const pageSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body_html: z.string(),
  status: z.enum(STATUSES),
});

const reorderSchema = z.object({
  items: z.array(z.object({
    id: z.uuid(),
    sort_order: z.number().int(),
  })).min(1),
});

type TargetInput = z.infer<typeof targetSchema>;

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
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

function actorId(req: AuthRequest): string | null {
  return req.user?.id ?? null;
}

function auditCopy(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  const copy: Record<string, unknown> = { ...row };
  for (const key of ['body_html', 'answer_html']) {
    if (typeof copy[key] === 'string') {
      copy[key] = (copy[key] as string).slice(0, 500);
    }
  }
  return copy;
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'item';
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505');
}

function searchTerm(value: string): string {
  return value.replace(/[%_\\]/g, '').trim();
}

async function uniqueSlug(
  table: 'content_articles' | 'faq_categories',
  base: string,
  ignoreId?: string
): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  let suffix = 2;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();

    if (error) throw error;
    if (!data || data.id === ignoreId) return candidate;
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }

  throw new Error('Could not allocate a unique slug');
}

async function replaceTargets(articleId: string, targets: TargetInput[]) {
  const { error: deleteError } = await supabaseAdmin
    .from('content_targets')
    .delete()
    .eq('article_id', articleId);

  if (deleteError) throw deleteError;
  if (targets.length === 0) return;

  const { error: insertError } = await supabaseAdmin.from('content_targets').insert(
    targets.map((target) => ({
      article_id: articleId,
      target_type: target.target_type,
      target_id: target.target_type === 'all' ? null : target.target_id,
    }))
  );

  if (insertError) throw insertError;
}

async function loadArticle(id: string) {
  const { data, error } = await supabaseAdmin
    .from('content_articles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { data: targets, error: targetError } = await supabaseAdmin
    .from('content_targets')
    .select('id, target_type, target_id')
    .eq('article_id', id);

  if (targetError) throw targetError;
  return { ...data, targets: targets || [] };
}

export async function listArticles(req: AuthRequest, res: Response) {
  try {
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const search = typeof req.query.search === 'string' ? searchTerm(req.query.search) : '';

    if (type && !ARTICLE_TYPES.includes(type as (typeof ARTICLE_TYPES)[number])) {
      return errorResponse(res, 'Invalid article type', 400);
    }
    if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      return errorResponse(res, 'Invalid article status', 400);
    }

    let query = supabaseAdmin
      .from('content_articles')
      .select('id, type, title, slug, summary, status, sort_order, published_at, updated_at, created_at')
      .order('updated_at', { ascending: false });

    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);
    if (search) query = query.ilike('title', `%${search}%`);

    const { data, error } = await query;
    if (error) {
      logDb('list articles', error);
      return errorResponse(res, 'Failed to load articles', 500);
    }

    return successResponse(res, data || []);
  } catch (error) {
    logDb('list articles', error);
    return errorResponse(res, 'Failed to load articles', 500);
  }
}

export async function getArticle(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) {
      return errorResponse(res, 'Invalid article id', 400);
    }

    const article = await loadArticle(id);
    if (!article) return errorResponse(res, 'Article not found', 404);
    return successResponse(res, article);
  } catch (error) {
    logDb('get article', error);
    return errorResponse(res, 'Failed to load article', 500);
  }
}

export async function createArticle(req: AuthRequest, res: Response) {
  try {
    const body = parseBody(articleSchema, req.body, res, 'Invalid article details');
    if (!body) return;

    const slug = body.slug
      ? await uniqueSlug('content_articles', body.slug)
      : await uniqueSlug('content_articles', body.title);

    if (body.slug && slug !== slugify(body.slug)) {
      return errorResponse(res, 'An article with this address already exists', 409);
    }

    const status = body.status || 'draft';
    const { data, error } = await supabaseAdmin
      .from('content_articles')
      .insert({
        type: body.type,
        title: body.title,
        slug,
        summary: body.summary ?? null,
        body_html: sanitizeContentHtml(body.body_html || ''),
        attachment_url: body.attachment_url ?? null,
        status,
        sort_order: body.sort_order ?? 0,
        published_at: status === 'published' ? new Date().toISOString() : null,
        created_by: actorId(req),
        updated_by: actorId(req),
      })
      .select('*')
      .single();

    if (error) {
      logDb('create article', error);
      if (isUniqueViolation(error)) {
        return errorResponse(res, 'An article with this address already exists', 409);
      }
      return errorResponse(res, 'Failed to create article', 500);
    }

    try {
      await replaceTargets(data.id, body.targets);
    } catch (targetError) {
      logDb('create article targets', targetError);
      await supabaseAdmin.from('content_articles').delete().eq('id', data.id);
      return errorResponse(res, 'Failed to save article targets', 500);
    }

    const article = await loadArticle(data.id);
    await logAudit({
      req,
      entity: 'content_article',
      entityId: data.id,
      action: 'create',
      after: auditCopy(article),
    });

    return successResponse(res, article, 'Article created', 201);
  } catch (error) {
    logDb('create article', error);
    return errorResponse(res, 'Failed to create article', 500);
  }
}

export async function updateArticle(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) {
      return errorResponse(res, 'Invalid article id', 400);
    }

    const body = parseBody(articleUpdateSchema, req.body, res, 'Invalid article details');
    if (!body) return;

    const before = await loadArticle(id);
    if (!before) return errorResponse(res, 'Article not found', 404);

    const updates: Record<string, unknown> = { updated_by: actorId(req) };

    if (body.type !== undefined) updates.type = body.type;
    if (body.title !== undefined) updates.title = body.title;
    if (body.summary !== undefined) updates.summary = body.summary;
    if (body.attachment_url !== undefined) updates.attachment_url = body.attachment_url;
    if (body.sort_order !== undefined) updates.sort_order = body.sort_order;
    if (body.body_html !== undefined) updates.body_html = sanitizeContentHtml(body.body_html);
    if (body.status !== undefined) {
      updates.status = body.status;
      if (body.status === 'published' && !before.published_at) {
        updates.published_at = new Date().toISOString();
      }
    }
    if (body.slug !== undefined && body.slug !== '') {
      const nextSlug = await uniqueSlug('content_articles', body.slug, id);
      if (nextSlug !== slugify(body.slug)) {
        return errorResponse(res, 'An article with this address already exists', 409);
      }
      updates.slug = nextSlug;
    } else if (body.slug === '' && body.title) {
      updates.slug = await uniqueSlug('content_articles', body.title, id);
    }

    const { error } = await supabaseAdmin.from('content_articles').update(updates).eq('id', id);
    if (error) {
      logDb('update article', error);
      if (isUniqueViolation(error)) {
        return errorResponse(res, 'An article with this address already exists', 409);
      }
      return errorResponse(res, 'Failed to update article', 500);
    }

    if (body.targets) {
      await replaceTargets(id, body.targets);
    }

    const after = await loadArticle(id);
    await logAudit({
      req,
      entity: 'content_article',
      entityId: id,
      action: 'update',
      before: auditCopy(before),
      after: auditCopy(after),
    });

    return successResponse(res, after, 'Article updated');
  } catch (error) {
    logDb('update article', error);
    return errorResponse(res, 'Failed to update article', 500);
  }
}

export async function deleteArticle(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) {
      return errorResponse(res, 'Invalid article id', 400);
    }

    const before = await loadArticle(id);
    if (!before) return errorResponse(res, 'Article not found', 404);

    const { error } = await supabaseAdmin.from('content_articles').delete().eq('id', id);
    if (error) {
      logDb('delete article', error);
      return errorResponse(res, 'Failed to delete article', 500);
    }

    await logAudit({
      req,
      entity: 'content_article',
      entityId: id,
      action: 'delete',
      before: auditCopy(before),
    });

    return successResponse(res, null, 'Article deleted');
  } catch (error) {
    logDb('delete article', error);
    return errorResponse(res, 'Failed to delete article', 500);
  }
}

async function setArticleStatus(req: AuthRequest, res: Response, status: 'published' | 'draft', action: 'publish' | 'unpublish') {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) {
      return errorResponse(res, 'Invalid article id', 400);
    }

    const before = await loadArticle(id);
    if (!before) return errorResponse(res, 'Article not found', 404);

    const updates: Record<string, unknown> = {
      status,
      updated_by: actorId(req),
    };
    if (status === 'published' && !before.published_at) {
      updates.published_at = new Date().toISOString();
    }

    const { error } = await supabaseAdmin.from('content_articles').update(updates).eq('id', id);
    if (error) {
      logDb(`${action} article`, error);
      return errorResponse(res, 'Failed to update article', 500);
    }

    const after = await loadArticle(id);
    await logAudit({
      req,
      entity: 'content_article',
      entityId: id,
      action,
      before: auditCopy(before),
      after: auditCopy(after),
    });

    return successResponse(res, after, status === 'published' ? 'Article published' : 'Article unpublished');
  } catch (error) {
    logDb(`${action} article`, error);
    return errorResponse(res, 'Failed to update article', 500);
  }
}

export function publishArticle(req: AuthRequest, res: Response) {
  return setArticleStatus(req, res, 'published', 'publish');
}

export function unpublishArticle(req: AuthRequest, res: Response) {
  return setArticleStatus(req, res, 'draft', 'unpublish');
}

export async function listFaqCategories(_req: AuthRequest, res: Response) {
  try {
    const { data, error } = await supabaseAdmin
      .from('faq_categories')
      .select('id, name, slug, sort_order, is_active, created_at, updated_at')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      logDb('list faq categories', error);
      return errorResponse(res, 'Failed to load FAQ categories', 500);
    }

    return successResponse(res, data || []);
  } catch (error) {
    logDb('list faq categories', error);
    return errorResponse(res, 'Failed to load FAQ categories', 500);
  }
}

export async function createFaqCategory(req: AuthRequest, res: Response) {
  try {
    const body = parseBody(categorySchema, req.body, res, 'Invalid category details');
    if (!body) return;

    const slug = await uniqueSlug('faq_categories', body.name);
    const { data, error } = await supabaseAdmin
      .from('faq_categories')
      .insert({
        name: body.name,
        slug,
        sort_order: body.sort_order ?? 0,
        is_active: body.is_active ?? true,
      })
      .select('*')
      .single();

    if (error) {
      logDb('create faq category', error);
      if (isUniqueViolation(error)) {
        return errorResponse(res, 'A category with this name already exists', 409);
      }
      return errorResponse(res, 'Failed to create FAQ category', 500);
    }

    await logAudit({
      req,
      entity: 'faq_category',
      entityId: data.id,
      action: 'create',
      after: auditCopy(data),
    });

    return successResponse(res, data, 'FAQ category created', 201);
  } catch (error) {
    logDb('create faq category', error);
    return errorResponse(res, 'Failed to create FAQ category', 500);
  }
}

export async function updateFaqCategory(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) {
      return errorResponse(res, 'Invalid category id', 400);
    }

    const body = parseBody(categorySchema.partial(), req.body, res, 'Invalid category details');
    if (!body) return;

    const { data: before, error: beforeError } = await supabaseAdmin
      .from('faq_categories')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (beforeError) {
      logDb('update faq category lookup', beforeError);
      return errorResponse(res, 'Failed to update FAQ category', 500);
    }
    if (!before) return errorResponse(res, 'FAQ category not found', 404);

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.sort_order !== undefined) updates.sort_order = body.sort_order;
    if (body.is_active !== undefined) updates.is_active = body.is_active;

    const { data, error } = await supabaseAdmin
      .from('faq_categories')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      logDb('update faq category', error);
      if (isUniqueViolation(error)) {
        return errorResponse(res, 'A category with this name already exists', 409);
      }
      return errorResponse(res, 'Failed to update FAQ category', 500);
    }

    await logAudit({
      req,
      entity: 'faq_category',
      entityId: id,
      action: 'update',
      before: auditCopy(before),
      after: auditCopy(data),
    });

    return successResponse(res, data, 'FAQ category updated');
  } catch (error) {
    logDb('update faq category', error);
    return errorResponse(res, 'Failed to update FAQ category', 500);
  }
}

export async function deleteFaqCategory(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) {
      return errorResponse(res, 'Invalid category id', 400);
    }

    const { data: before, error: beforeError } = await supabaseAdmin
      .from('faq_categories')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (beforeError) {
      logDb('delete faq category lookup', beforeError);
      return errorResponse(res, 'Failed to delete FAQ category', 500);
    }
    if (!before) return errorResponse(res, 'FAQ category not found', 404);

    const { count, error: countError } = await supabaseAdmin
      .from('faqs')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', id);

    if (countError) {
      logDb('delete faq category count', countError);
      return errorResponse(res, 'Failed to delete FAQ category', 500);
    }
    if ((count || 0) > 0) {
      return errorResponse(res, 'This category still has FAQs. Move or delete them first.', 409);
    }

    const { error } = await supabaseAdmin.from('faq_categories').delete().eq('id', id);
    if (error) {
      logDb('delete faq category', error);
      return errorResponse(res, 'Failed to delete FAQ category', 500);
    }

    await logAudit({
      req,
      entity: 'faq_category',
      entityId: id,
      action: 'delete',
      before: auditCopy(before),
    });

    return successResponse(res, null, 'FAQ category deleted');
  } catch (error) {
    logDb('delete faq category', error);
    return errorResponse(res, 'Failed to delete FAQ category', 500);
  }
}

async function reorderRows(
  req: AuthRequest,
  res: Response,
  table: 'faq_categories' | 'faqs',
  entity: 'faq_category' | 'faq'
) {
  try {
    const body = parseBody(reorderSchema, req.body, res, 'Invalid order');
    if (!body) return;

    const before = body.items.map((item) => item.id);
    for (const item of body.items) {
      const { error } = await supabaseAdmin
        .from(table)
        .update({ sort_order: item.sort_order })
        .eq('id', item.id);

      if (error) {
        logDb(`reorder ${table}`, error);
        return errorResponse(res, 'Failed to save order', 500);
      }
    }

    await logAudit({
      req,
      entity,
      entityId: body.items[0]?.id ?? null,
      action: 'update',
      before: { ids: before },
      after: { items: body.items },
    });

    return successResponse(res, body.items, 'Order saved');
  } catch (error) {
    logDb(`reorder ${table}`, error);
    return errorResponse(res, 'Failed to save order', 500);
  }
}

export function reorderFaqCategories(req: AuthRequest, res: Response) {
  return reorderRows(req, res, 'faq_categories', 'faq_category');
}

export async function listFaqs(req: AuthRequest, res: Response) {
  try {
    const categoryId = typeof req.query.category_id === 'string' ? req.query.category_id : '';
    if (categoryId && !z.uuid().safeParse(categoryId).success) {
      return errorResponse(res, 'Invalid category id', 400);
    }

    let query = supabaseAdmin
      .from('faqs')
      .select('id, category_id, question, answer_html, status, sort_order, updated_by, created_at, updated_at')
      .order('sort_order', { ascending: true });

    if (categoryId) query = query.eq('category_id', categoryId);

    const { data, error } = await query;
    if (error) {
      logDb('list faqs', error);
      return errorResponse(res, 'Failed to load FAQs', 500);
    }

    return successResponse(res, data || []);
  } catch (error) {
    logDb('list faqs', error);
    return errorResponse(res, 'Failed to load FAQs', 500);
  }
}

export async function createFaq(req: AuthRequest, res: Response) {
  try {
    const body = parseBody(faqSchema, req.body, res, 'Invalid FAQ details');
    if (!body) return;

    const { data, error } = await supabaseAdmin
      .from('faqs')
      .insert({
        category_id: body.category_id,
        question: body.question,
        answer_html: sanitizeContentHtml(body.answer_html),
        status: body.status || 'published',
        sort_order: body.sort_order ?? 0,
        updated_by: actorId(req),
      })
      .select('*')
      .single();

    if (error) {
      logDb('create faq', error);
      return errorResponse(res, 'Failed to create FAQ', 500);
    }

    await logAudit({
      req,
      entity: 'faq',
      entityId: data.id,
      action: 'create',
      after: auditCopy(data),
    });

    return successResponse(res, data, 'FAQ created', 201);
  } catch (error) {
    logDb('create faq', error);
    return errorResponse(res, 'Failed to create FAQ', 500);
  }
}

export async function updateFaq(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) {
      return errorResponse(res, 'Invalid FAQ id', 400);
    }

    const body = parseBody(faqUpdateSchema, req.body, res, 'Invalid FAQ details');
    if (!body) return;

    const { data: before, error: beforeError } = await supabaseAdmin
      .from('faqs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (beforeError) {
      logDb('update faq lookup', beforeError);
      return errorResponse(res, 'Failed to update FAQ', 500);
    }
    if (!before) return errorResponse(res, 'FAQ not found', 404);

    const updates: Record<string, unknown> = { updated_by: actorId(req) };
    if (body.category_id !== undefined) updates.category_id = body.category_id;
    if (body.question !== undefined) updates.question = body.question;
    if (body.answer_html !== undefined) updates.answer_html = sanitizeContentHtml(body.answer_html);
    if (body.status !== undefined) updates.status = body.status;
    if (body.sort_order !== undefined) updates.sort_order = body.sort_order;

    const { data, error } = await supabaseAdmin
      .from('faqs')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      logDb('update faq', error);
      return errorResponse(res, 'Failed to update FAQ', 500);
    }

    await logAudit({
      req,
      entity: 'faq',
      entityId: id,
      action: 'update',
      before: auditCopy(before),
      after: auditCopy(data),
    });

    return successResponse(res, data, 'FAQ updated');
  } catch (error) {
    logDb('update faq', error);
    return errorResponse(res, 'Failed to update FAQ', 500);
  }
}

export async function deleteFaq(req: AuthRequest, res: Response) {
  try {
    const id = param(req.params.id);
    if (!z.uuid().safeParse(id).success) {
      return errorResponse(res, 'Invalid FAQ id', 400);
    }

    const { data: before, error: beforeError } = await supabaseAdmin
      .from('faqs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (beforeError) {
      logDb('delete faq lookup', beforeError);
      return errorResponse(res, 'Failed to delete FAQ', 500);
    }
    if (!before) return errorResponse(res, 'FAQ not found', 404);

    const { error } = await supabaseAdmin.from('faqs').delete().eq('id', id);
    if (error) {
      logDb('delete faq', error);
      return errorResponse(res, 'Failed to delete FAQ', 500);
    }

    await logAudit({
      req,
      entity: 'faq',
      entityId: id,
      action: 'delete',
      before: auditCopy(before),
    });

    return successResponse(res, null, 'FAQ deleted');
  } catch (error) {
    logDb('delete faq', error);
    return errorResponse(res, 'Failed to delete FAQ', 500);
  }
}

export function reorderFaqs(req: AuthRequest, res: Response) {
  return reorderRows(req, res, 'faqs', 'faq');
}

export async function listPages(_req: AuthRequest, res: Response) {
  try {
    const { data, error } = await supabaseAdmin
      .from('content_pages')
      .select('id, slug, title, status, version, updated_by, updated_at')
      .order('slug', { ascending: true });

    if (error) {
      logDb('list pages', error);
      return errorResponse(res, 'Failed to load pages', 500);
    }

    return successResponse(res, data || []);
  } catch (error) {
    logDb('list pages', error);
    return errorResponse(res, 'Failed to load pages', 500);
  }
}

export async function getPage(req: AuthRequest, res: Response) {
  try {
    const slug = param(req.params.slug);
    if (!PAGE_SLUGS.includes(slug as (typeof PAGE_SLUGS)[number])) {
      return errorResponse(res, 'Page not found', 404);
    }

    const { data, error } = await supabaseAdmin
      .from('content_pages')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      logDb('get page', error);
      return errorResponse(res, 'Failed to load page', 500);
    }
    if (!data) return errorResponse(res, 'Page not found', 404);

    return successResponse(res, data);
  } catch (error) {
    logDb('get page', error);
    return errorResponse(res, 'Failed to load page', 500);
  }
}

export async function updatePage(req: AuthRequest, res: Response) {
  try {
    const slug = param(req.params.slug);
    if (!PAGE_SLUGS.includes(slug as (typeof PAGE_SLUGS)[number])) {
      return errorResponse(res, 'Page not found', 404);
    }

    const body = parseBody(pageSchema, req.body, res, 'Invalid page details');
    if (!body) return;

    const { data: before, error: beforeError } = await supabaseAdmin
      .from('content_pages')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (beforeError) {
      logDb('update page lookup', beforeError);
      return errorResponse(res, 'Failed to update page', 500);
    }
    if (!before) return errorResponse(res, 'Page not found', 404);

    const { data, error } = await supabaseAdmin
      .from('content_pages')
      .update({
        title: body.title,
        body_html: sanitizeContentHtml(body.body_html),
        status: body.status,
        version: before.version + 1,
        updated_by: actorId(req),
      })
      .eq('id', before.id)
      .select('*')
      .single();

    if (error) {
      logDb('update page', error);
      return errorResponse(res, 'Failed to update page', 500);
    }

    await logAudit({
      req,
      entity: 'content_page',
      entityId: data.id,
      action: 'update',
      before: auditCopy(before),
      after: auditCopy(data),
    });

    return successResponse(res, data, 'Page updated');
  } catch (error) {
    logDb('update page', error);
    return errorResponse(res, 'Failed to update page', 500);
  }
}
