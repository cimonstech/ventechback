import { z } from 'zod';
import { supabaseAdmin } from '../utils/supabaseClient';

export const ARTICLE_TYPES = [
  'user_guide',
  'maintenance',
  'troubleshooting',
  'hardware',
  'software',
  'battery',
  'warranty',
] as const;

const TARGET_RANK: Record<string, number> = {
  product: 0,
  brand: 1,
  category: 2,
  all: 3,
};

export type GuideArticle = {
  id: string;
  type: string;
  title: string;
  slug: string;
  summary: string | null;
  updated_at: string;
  sort_order: number;
  target_type: string;
};

export type GuideGroups = Record<(typeof ARTICLE_TYPES)[number], GuideArticle[]>;

export function emptyGuides(): GuideGroups {
  const grouped = {} as GuideGroups;
  for (const type of ARTICLE_TYPES) {
    grouped[type] = [];
  }
  return grouped;
}

export async function guidesForProduct(productId: string): Promise<
  | { ok: true; guides: GuideGroups }
  | { ok: false; code: 'invalid' | 'not_found' | 'failed' }
> {
  if (!z.uuid().safeParse(productId).success) {
    return { ok: false, code: 'invalid' };
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from('products')
    .select('id, brand_id, category_id')
    .eq('id', productId)
    .maybeSingle();

  if (productError) {
    console.error('articles for product lookup', productError);
    return { ok: false, code: 'failed' };
  }

  if (!product) {
    return { ok: false, code: 'not_found' };
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
    console.error('articles for product targets', targetError);
    return { ok: false, code: 'failed' };
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

  const grouped = emptyGuides();
  for (const entry of best.values()) {
    const list = grouped[entry.article.type as (typeof ARTICLE_TYPES)[number]];
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
      const byTarget = (TARGET_RANK[left.target_type] ?? 99) - (TARGET_RANK[right.target_type] ?? 99);
      if (byTarget !== 0) return byTarget;
      const byOrder = Number(left.sort_order) - Number(right.sort_order);
      if (byOrder !== 0) return byOrder;
      return String(left.title).localeCompare(String(right.title));
    });
  }

  return { ok: true, guides: grouped };
}
