import { Request, Response } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { errorResponse, successResponse } from '../utils/responseHandlers';
import { ARTICLE_TYPES, guidesForProduct } from '../services/contentGuides.service';
import { defaultGuideBySlug } from '../services/devicePortalDefaults.service';

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function logDb(scope: string, error: unknown) {
  console.error(scope, error);
}

export async function listPublicFaqs(_req: Request, res: Response) {
  try {
    const { data: categories, error: categoryError } = await supabaseAdmin
      .from('faq_categories')
      .select('id, name, slug, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (categoryError) {
      logDb('list public faqs categories', categoryError);
      return errorResponse(res, 'Failed to load FAQs', 500);
    }

    const ids = (categories || []).map((category) => category.id);
    const faqsByCategory = new Map<string, Array<Record<string, unknown>>>();

    if (ids.length > 0) {
      const { data: faqs, error: faqError } = await supabaseAdmin
        .from('faqs')
        .select('id, category_id, question, answer_html, sort_order')
        .eq('status', 'published')
        .in('category_id', ids)
        .order('sort_order', { ascending: true });

      if (faqError) {
        logDb('list public faqs', faqError);
        return errorResponse(res, 'Failed to load FAQs', 500);
      }

      for (const faq of faqs || []) {
        const list = faqsByCategory.get(faq.category_id) || [];
        list.push({
          id: faq.id,
          question: faq.question,
          answer_html: faq.answer_html,
          sort_order: faq.sort_order,
        });
        faqsByCategory.set(faq.category_id, list);
      }
    }

    const data = (categories || []).map((category) => ({
      ...category,
      faqs: faqsByCategory.get(category.id) || [],
    }));

    return successResponse(res, data);
  } catch (error) {
    logDb('list public faqs', error);
    return errorResponse(res, 'Failed to load FAQs', 500);
  }
}

export async function getPublicPage(req: Request, res: Response) {
  try {
    const slug = param(req.params.slug);
    const { data, error } = await supabaseAdmin
      .from('content_pages')
      .select('id, slug, title, body_html, status, version, updated_at')
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      logDb('get public page', error);
      return errorResponse(res, 'Failed to load page', 500);
    }

    if (!data || data.status !== 'published') {
      return errorResponse(res, 'Page not found', 404);
    }

    return successResponse(res, {
      id: data.id,
      slug: data.slug,
      title: data.title,
      body_html: data.body_html,
      version: data.version,
      updated_at: data.updated_at,
    });
  } catch (error) {
    logDb('get public page', error);
    return errorResponse(res, 'Failed to load page', 500);
  }
}

export async function listPublicArticles(req: Request, res: Response) {
  try {
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    if (type && !ARTICLE_TYPES.includes(type as (typeof ARTICLE_TYPES)[number])) {
      return errorResponse(res, 'Invalid article type', 400);
    }

    let query = supabaseAdmin
      .from('content_articles')
      .select('id, type, title, slug, summary, updated_at')
      .eq('status', 'published')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true });

    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) {
      logDb('list public articles', error);
      return errorResponse(res, 'Failed to load articles', 500);
    }

    return successResponse(res, data || []);
  } catch (error) {
    logDb('list public articles', error);
    return errorResponse(res, 'Failed to load articles', 500);
  }
}

export async function getPublicArticle(req: Request, res: Response) {
  try {
    const slug = param(req.params.slug);
    if (!slug) return errorResponse(res, 'Article not found', 404);
    const { data, error } = await supabaseAdmin
      .from('content_articles')
      .select('id, type, title, slug, summary, body_html, attachment_url, sort_order, published_at, updated_at, status')
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      logDb('get public article', error);
      return errorResponse(res, 'Failed to load article', 500);
    }

    if (!data || data.status !== 'published') {
      const fallback = defaultGuideBySlug(slug);
      if (fallback) {
        return successResponse(res, {
          id: fallback.id,
          type: fallback.type,
          title: fallback.title,
          slug: fallback.slug,
          summary: fallback.summary,
          body_html: fallback.body_html,
          attachment_url: null,
          sort_order: fallback.sort_order,
          published_at: fallback.updated_at,
          updated_at: fallback.updated_at,
        });
      }
      return errorResponse(res, 'Article not found', 404);
    }

    const { status: _status, ...article } = data;
    return successResponse(res, article);
  } catch (error) {
    logDb('get public article', error);
    return errorResponse(res, 'Failed to load article', 500);
  }
}

export async function articlesForProduct(req: Request, res: Response) {
  try {
    const productId = param(req.params.productId);
    const result = await guidesForProduct(productId);
    if (!result.ok) {
      if (result.code === 'invalid') return errorResponse(res, 'Invalid product id', 400);
      if (result.code === 'not_found') return errorResponse(res, 'Product not found', 404);
      return errorResponse(res, 'Failed to load articles', 500);
    }

    return successResponse(res, result.guides);
  } catch (error) {
    logDb('articles for product', error);
    return errorResponse(res, 'Failed to load articles', 500);
  }
}
