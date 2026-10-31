import { Request, Response } from 'express';
import { supabaseAdmin } from '../utils/supabaseClient';
import { successResponse, errorResponse, forbiddenResponse, paginatedResponse } from '../utils/responseHandlers';
import { AuthRequest, staffHasModuleAccess } from '../middleware/auth.middleware';

export const PRE_ORDER_PRODUCT_FIELDS = [
  'is_pre_order',
  'pre_order_available',
  'estimated_arrival_date',
] as const;

export function isPreOrderOnlyProductPatch(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }

  const record = body as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'variants')) {
    return false;
  }

  const keys = Object.keys(record);
  if (keys.length === 0) {
    return false;
  }

  return keys.every((key) =>
    (PRE_ORDER_PRODUCT_FIELDS as readonly string[]).includes(key)
  );
}

export const getAllProducts = async (req: Request, res: Response) => {
  try {
    const {
      page = 1,
      limit = 12,
      category,
      brand,
      minPrice,
      maxPrice,
      inStock,
      rating,
      search,
      sortBy = 'created_at',
      sortOrder = 'desc',
      operating_system,
      condition,
    } = req.query;

    const parsedPage = parseInt(String(page), 10);
    const pageNum = Number.isFinite(parsedPage) ? Math.max(0, parsedPage) : 1;
    const parsedLimit = parseInt(String(limit), 10);
    const limitNum = Math.min(100, Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 12));
    const parsedOffset =
      req.query.offset == null ? NaN : parseInt(String(req.query.offset), 10);
    const offset = Number.isFinite(parsedOffset)
      ? Math.max(0, parsedOffset)
      : Math.max(0, (Math.max(pageNum, 1) - 1) * limitNum);
    const PRODUCT_SORT_COLUMNS = ['created_at', 'price', 'rating', 'name'] as const;
    const sortColumn = PRODUCT_SORT_COLUMNS.includes(sortBy as (typeof PRODUCT_SORT_COLUMNS)[number])
      ? (sortBy as (typeof PRODUCT_SORT_COLUMNS)[number])
      : 'created_at';
    const rawSearch = Array.isArray(search) ? search[0] : search;
    const cleanedSearch =
      typeof rawSearch === 'string'
        ? rawSearch.trim().slice(0, 100).replace(/[,():*%\\]/g, '').trim()
        : '';

    // Select products with category relationship
    // Note: count: 'exact' with relationships can cause corrupted errors, so we'll get count separately
    let query = supabaseAdmin
      .from('products')
      .select('*, category:categories(name, slug)');
    
    // Create a separate count query without relationships to avoid corruption
    let countQuery = supabaseAdmin
      .from('products')
      .select('*', { count: 'exact', head: true });

    // Apply filters to both queries
    if (category) {
      query = query.eq('category_id', category);
      countQuery = countQuery.eq('category_id', category);
    }

    if (brand) {
      // Brand filter - can filter by brand name (text) or brand_id (UUID)
      const brands = (brand as string).split(',').map(b => b.trim());
      // Try to match as UUIDs first (brand_id), otherwise treat as brand names
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (brands.every(b => isUUID.test(b))) {
        // All are UUIDs, filter by brand_id
        query = query.in('brand_id', brands);
        countQuery = countQuery.in('brand_id', brands);
      } else {
        // Treat as brand names - look up brand IDs from brands table
        // This avoids errors if brand column doesn't exist in products table
        const { data: brandData, error: brandError } = await supabaseAdmin
          .from('brands')
          .select('id')
          .in('name', brands);
        
        if (brandError || !brandData || brandData.length === 0) {
          // No brands found or error - return empty result by filtering with non-existent ID
          query = query.eq('id', '00000000-0000-0000-0000-000000000000');
          countQuery = countQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        } else {
          const brandIds = brandData.map(b => b.id);
          query = query.in('brand_id', brandIds);
          countQuery = countQuery.in('brand_id', brandIds);
        }
      }
    }

    if (minPrice) {
      query = query.gte('discount_price', parseFloat(minPrice as string));
      countQuery = countQuery.gte('discount_price', parseFloat(minPrice as string));
    }

    if (maxPrice) {
      query = query.lte('discount_price', parseFloat(maxPrice as string));
      countQuery = countQuery.lte('discount_price', parseFloat(maxPrice as string));
    }

    if (inStock === 'true') {
      query = query.eq('in_stock', true).gt('stock_quantity', 0);
      countQuery = countQuery.eq('in_stock', true).gt('stock_quantity', 0);
    }

    if (rating) {
      query = query.gte('rating', parseFloat(rating as string));
      countQuery = countQuery.gte('rating', parseFloat(rating as string));
    }

    if (cleanedSearch) {
      const searchFilter = `name.ilike.%${cleanedSearch}%,description.ilike.%${cleanedSearch}%`;
      query = query.or(searchFilter);
      countQuery = countQuery.or(searchFilter);
    }

    const osValue = Array.isArray(operating_system) ? operating_system[0] : operating_system;
    if (typeof osValue === 'string' && osValue.trim()) {
      query = query.eq('operating_system', osValue.trim());
      countQuery = countQuery.eq('operating_system', osValue.trim());
    }

    const conditionValue = Array.isArray(condition) ? condition[0] : condition;
    if (typeof conditionValue === 'string' && conditionValue.trim()) {
      query = query.eq('condition', conditionValue.trim());
      countQuery = countQuery.eq('condition', conditionValue.trim());
    }

    // Apply sorting
    const ascending = String(sortOrder) === 'asc';
    query = query.order(sortColumn, { ascending });

    // Apply pagination (only to data query, not count query)
    query = query.range(offset, offset + limitNum - 1);

    // Execute both queries in parallel
    const [result, countResult] = await Promise.all([
      query,
      countQuery
    ]);

    // Handle errors - check both queries
    if (result.error) {
      const error = result.error;
      console.error('Data query error:', error);
      throw error;
    }

    if (countResult.error) {
      const error = countResult.error;
      console.error('Count query error:', error);
      // If count fails, we can still return data with count = 0 or data.length
      console.warn('Count query failed, using data length as fallback');
    }

    const { data } = result;
    const count = countResult.count ?? data?.length ?? 0;

    return paginatedResponse(res, data || [], {
      page: pageNum,
      limit: limitNum,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limitNum),
    });
  } catch (error: any) {
    console.error('Get products error:', error);
    const { message, status } = productWriteError(error, 'Could not load products.');
    return errorResponse(res, message, status);
  }
};

export const getProductBySlug = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*, category:categories(*), variants:product_variants(*)')
      .eq('slug', slug)
      .single();

    if (error) throw error;
    if (!data) {
      return errorResponse(res, 'Product not found', 404);
    }

    return successResponse(res, data);
  } catch (error: any) {
    console.error('Get product error:', error);
    if (error?.code === 'PGRST116') {
      return errorResponse(res, 'Product not found', 404);
    }
    const { message, status } = productWriteError(error, 'Could not load this product.');
    return errorResponse(res, message, status);
  }
};

// In-memory cache for featured products
// In production, consider using Redis for distributed caching
interface FeaturedProductsCache {
  data: any[] | null;
  timestamp: number | null;
  limit: number;
}

const featuredProductsCache: FeaturedProductsCache = {
  data: null,
  timestamp: null,
  limit: 8,
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

// Determine which featured column name to use (check once at startup)
let featuredColumnName: 'featured' | 'is_featured' | null = null;

const detectFeaturedColumn = async (): Promise<'featured' | 'is_featured'> => {
  if (featuredColumnName) return featuredColumnName;

  // Try 'featured' first
  const { error } = await supabaseAdmin
    .from('products')
    .select('featured')
    .limit(1);

  if (!error) {
    featuredColumnName = 'featured';
    return 'featured';
  }

  // Fallback to 'is_featured'
  featuredColumnName = 'is_featured';
  return 'is_featured';
};

export const getFeaturedProducts = async (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || '8');
    const now = Date.now();

    // Check cache first
    if (
      featuredProductsCache.data &&
      featuredProductsCache.timestamp &&
      featuredProductsCache.limit === limit &&
      (now - featuredProductsCache.timestamp) < CACHE_TTL
    ) {
      console.log('Serving featured products from cache');
      return successResponse(res, featuredProductsCache.data);
    }

    // Detect which column name to use (only once)
    const columnName = await detectFeaturedColumn();

    // Optimized query: select only needed columns, use composite index
    // The index idx_products_featured_in_stock_created should cover this query
    const { data, error } = await supabaseAdmin
      .from('products')
      .select(
        'id, name, slug, description, thumbnail, images, original_price, discount_price, rating, review_count, in_stock, stock_quantity, created_at, updated_at, category_id, brand_id'
      )
      .eq(columnName, true)
      .eq('in_stock', true)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Get featured products error:', error);
      throw error;
    }

    // Update cache
    featuredProductsCache.data = data || [];
    featuredProductsCache.timestamp = now;
    featuredProductsCache.limit = limit;

    return successResponse(res, data || []);
  } catch (error: any) {
    console.error('Get featured products error:', error);
    const { message, status } = productWriteError(error, 'Could not load featured products.');
    return errorResponse(res, message, status);
  }
};

// Helper function to invalidate cache (call this when products are updated)
const invalidateFeaturedProductsCache = () => {
  featuredProductsCache.data = null;
  featuredProductsCache.timestamp = null;
  console.log('Featured products cache invalidated');
};

async function saveProductVariants(productId: string, variants: any[]) {
  const { error: deleteMappingsError } = await supabaseAdmin
    .from('product_attribute_mappings')
    .delete()
    .eq('product_id', productId);
  if (deleteMappingsError) throw deleteMappingsError;

  const { error: deleteOptionsError } = await supabaseAdmin
    .from('product_selected_options')
    .delete()
    .eq('product_id', productId);
  if (deleteOptionsError) throw deleteOptionsError;

  if (variants.length === 0) return;

  const mappings = variants.map((variant, index) => ({
    product_id: productId,
    attribute_id: variant.attribute_id,
    is_required: variant.is_required,
    display_order: index,
  }));

  const { error: mappingError } = await supabaseAdmin
    .from('product_attribute_mappings')
    .insert(mappings);
  if (mappingError) throw mappingError;

  const selectedOptions = variants.flatMap((variant) =>
    (variant.selected_options || []).map((optionId: string) => ({
      product_id: productId,
      attribute_id: variant.attribute_id,
      option_id: optionId,
    }))
  );

  if (selectedOptions.length === 0) return;

  const { error: optionsError } = await supabaseAdmin
    .from('product_selected_options')
    .insert(selectedOptions);
  if (optionsError) throw optionsError;
}

function productWriteError(error: any, fallback: string): { message: string; status: number } {
  const code = String(error?.code || '');
  const raw = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();

  if (code === '23505' || raw.includes('duplicate key')) {
    if (raw.includes('products_sku_key') || raw.includes('(sku)')) {
      return { message: 'A product with this SKU already exists. Choose a different SKU.', status: 409 };
    }
    if (raw.includes('products_slug_key') || raw.includes('(slug)')) {
      return { message: 'A product with this web address already exists. Change the name or slug.', status: 409 };
    }
    return { message: 'A product with these details already exists.', status: 409 };
  }

  if (code === '23503' || raw.includes('foreign key')) {
    return { message: 'The selected category or brand could not be found.', status: 400 };
  }

  if (code === '23502' || raw.includes('null value')) {
    return { message: 'A required product field is missing.', status: 400 };
  }

  if (
    raw.includes('fetch failed') ||
    raw.includes('connect timeout') ||
    raw.includes('und_err_connect_timeout') ||
    raw.includes('econnrefused') ||
    raw.includes('enotfound')
  ) {
    return { message: 'Could not reach the database. Check your connection and try again.', status: 503 };
  }

  return { message: fallback, status: 500 };
}

const OPERATING_SYSTEMS = ['windows', 'macos', 'chromeos', 'linux', 'none'] as const;
const PRODUCT_CONDITIONS = ['new', 'refurbished', 'used'] as const;

function applyOperatingSystem(record: Record<string, any>, res: Response): boolean {
  if (!Object.prototype.hasOwnProperty.call(record, 'operating_system')) return true;
  const value = record.operating_system;
  if (value === null || value === '') {
    record.operating_system = null;
    return true;
  }
  if (typeof value !== 'string' || !OPERATING_SYSTEMS.includes(value as (typeof OPERATING_SYSTEMS)[number])) {
    errorResponse(res, 'Operating system must be windows, macos, chromeos, linux, or none.', 400);
    return false;
  }
  record.operating_system = value;
  return true;
}

function applyCondition(record: Record<string, any>, res: Response): boolean {
  if (!Object.prototype.hasOwnProperty.call(record, 'condition')) return true;
  const value = record.condition;
  if (value === null || value === '') {
    record.condition = 'new';
    return true;
  }
  if (typeof value !== 'string' || !PRODUCT_CONDITIONS.includes(value as (typeof PRODUCT_CONDITIONS)[number])) {
    errorResponse(res, 'Condition must be new, refurbished, or used.', 400);
    return false;
  }
  record.condition = value;
  return true;
}

function applyWarrantyMonths(record: Record<string, any>, res: Response): boolean {
  if (!Object.prototype.hasOwnProperty.call(record, 'warranty_months')) {
    return true;
  }

  const value = record.warranty_months;
  if (value === null || value === '') {
    record.warranty_months = null;
    return true;
  }

  if (typeof value !== 'number' && typeof value !== 'string') {
    errorResponse(res, 'Warranty months must be between 0 and 120.', 400);
    return false;
  }

  const months = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(months) || months < 0 || months > 120) {
    errorResponse(res, 'Warranty months must be between 0 and 120.', 400);
    return false;
  }

  record.warranty_months = months;
  return true;
}

export const createProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { variants, ...productData } = req.body;
    if (!applyWarrantyMonths(productData, res)) return;
    if (!applyOperatingSystem(productData, res)) return;
    if (!applyCondition(productData, res)) return;

    const { data, error } = await supabaseAdmin
      .from('products')
      .insert([productData])
      .select()
      .single();

    if (error) throw error;

    if (Array.isArray(variants)) {
      await saveProductVariants(data.id, variants);
    }

    // Invalidate featured products cache if new product is featured
    if (productData.featured === true || productData.is_featured === true) {
      invalidateFeaturedProductsCache();
    }

    return successResponse(res, data, 'Product created successfully', 201);
  } catch (error: any) {
    console.error('Create product error:', error?.message || error);
    const { message, status } = productWriteError(error, 'Failed to create product');
    return errorResponse(res, message, status);
  }
};

export const updateProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { variants, ...updates } = req.body;

    if (req.user?.role === 'staff' && !(await staffHasModuleAccess(req, 'products', 'edit'))) {
      if (Array.isArray(variants) || !isPreOrderOnlyProductPatch({ ...updates })) {
        return forbiddenResponse(res);
      }
    }

    if (!applyWarrantyMonths(updates, res)) return;
    if (!applyOperatingSystem(updates, res)) return;
    if (!applyCondition(updates, res)) return;

    // ✅ Auto-sync in_stock flag with stock_quantity
    // If stock_quantity is being updated, automatically set in_stock
    if (updates.stock_quantity !== undefined) {
      updates.in_stock = updates.stock_quantity > 0;
    }

    const { data, error } = await supabaseAdmin
      .from('products')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return errorResponse(res, 'Product not found', 404);
    }

    if (Array.isArray(variants)) {
      await saveProductVariants(Array.isArray(id) ? id[0] : id, variants);
    }

    // Invalidate featured products cache if featured status, stock status, or created_at changed
    if (
      updates.featured !== undefined ||
      updates.is_featured !== undefined ||
      updates.in_stock !== undefined ||
      updates.stock_quantity !== undefined ||
      updates.created_at !== undefined
    ) {
      invalidateFeaturedProductsCache();
    }

    return successResponse(res, data, 'Product updated successfully');
  } catch (error: any) {
    console.error('Update product error:', error?.message || error);
    const { message, status } = productWriteError(error, 'Failed to update product');
    return errorResponse(res, message, status);
  }
};

export const deleteProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check if product is featured before deleting (to invalidate cache if needed)
    const { data: product } = await supabaseAdmin
      .from('products')
      .select('featured, is_featured')
      .eq('id', id)
      .single();

    const { error } = await supabaseAdmin.from('products').delete().eq('id', id);

    if (error) throw error;

    // Invalidate cache if deleted product was featured
    if (product && (product.featured === true || product.is_featured === true)) {
      invalidateFeaturedProductsCache();
    }

    return successResponse(res, null, 'Product deleted successfully');
  } catch (error: any) {
    console.error('Delete product error:', error);
    const { message, status } = productWriteError(error, 'Could not delete this product.');
    return errorResponse(res, message, status);
  }
};

export const getAllCategories = async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('categories')
      .select('*')
      .order('order', { ascending: true });

    if (error) throw error;

    return successResponse(res, data || []);
  } catch (error: any) {
    console.error('Get categories error:', error);
    return errorResponse(res, 'Could not load categories.');
  }
};



