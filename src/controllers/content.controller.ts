import { Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../utils/supabaseClient';
import { errorResponse, successResponse } from '../utils/responseHandlers';

const ARTICLE_TYPES = [
  'user_guide',
  'maintenance',
  'troubleshooting',
  'hardware',
  'software',
  'warranty',
] as const;

const TARGET_RANK: Record<string, number> = {
  product: 0,
  brand: 1,
  category: 2,
  all: 3,
};

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
    if (!z.uuid().safeParse(productId).success) {
      return errorResponse(res, 'Invalid product id', 400);
    }

    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('id, brand_id, category_id')
      .eq('id', productId)
      .maybeSingle();

    if (productError) {
      logDb('articles for product lookup', productError);
      return errorResponse(res, 'Failed to load articles', 500);
    }

    if (!product) {
      return errorResponse(res, 'Product not found', 404);
    }

    const filters = [
      'and(target_type.eq.all,target_id.is.null)',
      `and(target_type.eq.product,target_id.eq.${productId})`,
    ];
    if (product.brand_id) {
      filters.push(`and(target_type.eq.brand,target_id.eq.${product.brand_id})`);
    }
    if (product.category_id) {
      filters.push(`and(target_type.eq.category,target_id.eq.${product.category_id})`);
    }

    const { data: targets, error: targetError } = await supabaseAdmin
      .from('content_targets')
      .select('target_type, article:content_articles!inner(id, type, title, slug, summary, updated_at, sort_order, status)')
      .or(filters.join(','));

    if (targetError) {
      logDb('articles for product targets', targetError);
      return errorResponse(res, 'Failed to load articles', 500);
    }

    const best = new Map<string, { article: Record<string, any>; targetType: string }>();
    for (const row of targets || []) {
      const embedded = row.article as Record<string, any> | Record<string, any>[] | null;
      const article = Array.isArray(embedded) ? embedded[0] : embedded;
      if (!article || article.status !== 'published') continue;

      const current = best.get(article.id);
      const nextRank = TARGET_RANK[row.target_type] ?? 99;
      const currentRank = current ? (TARGET_RANK[current.targetType] ?? 99) : 99;
      if (!current || nextRank < currentRank) {
        best.set(article.id, { article, targetType: row.target_type });
      }
    }

    const grouped: Record<string, Array<Record<string, unknown>>> = {};
    for (const type of ARTICLE_TYPES) {
      grouped[type] = [];
    }

    for (const entry of best.values()) {
      const list = grouped[entry.article.type];
      if (!list) continue;
      list.push({
        id: entry.article.id,
        type: entry.article.type,
        title: entry.article.title,
        slug: entry.article.slug,
        summary: entry.article.summary,
        updated_at: entry.article.updated_at,
        sort_order: entry.article.sort_order,
        target_type: entry.targetType,
      });
    }

    for (const type of ARTICLE_TYPES) {
      grouped[type].sort((left, right) => {
        const byTarget = (TARGET_RANK[String(left.target_type)] ?? 99) - (TARGET_RANK[String(right.target_type)] ?? 99);
        if (byTarget !== 0) return byTarget;
        const byOrder = Number(left.sort_order) - Number(right.sort_order);
        if (byOrder !== 0) return byOrder;
        return String(left.title).localeCompare(String(right.title));
      });
    }

    return successResponse(res, grouped);
  } catch (error) {
    logDb('articles for product', error);
    return errorResponse(res, 'Failed to load articles', 500);
  }
}
