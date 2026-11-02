-- Admin customer list and type counts.
-- Regular customers need NOT EXISTS on affiliates and investors.
-- Investor active/past needs EXISTS on vlb_investments.
-- PostgREST cannot express those cleanly.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_customers(
  p_type text,
  p_affiliate_status text,
  p_investor_status text,
  p_search text,
  p_from timestamptz,
  p_to timestamptz,
  p_sort text,
  p_limit integer,
  p_offset integer
)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  full_name text,
  phone text,
  created_at timestamptz,
  newsletter_subscribed boolean,
  is_affiliate boolean,
  affiliate_id uuid,
  affiliate_no text,
  affiliate_status text,
  affiliate_created_at timestamptz,
  is_investor boolean,
  investor_id uuid,
  investor_no text,
  investor_created_at timestamptz,
  active_investments_count integer,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
WITH filtered AS (
  SELECT
    u.id,
    u.email::text AS email,
    u.first_name::text AS first_name,
    u.last_name::text AS last_name,
    u.full_name::text AS full_name,
    u.phone::text AS phone,
    u.created_at,
    u.newsletter_subscribed,
    a.id AS affiliate_id,
    a.affiliate_no::text AS affiliate_no,
    a.status::text AS affiliate_status,
    a.created_at AS affiliate_created_at,
    i.id AS investor_id,
    i.investor_no::text AS investor_no,
    i.created_at AS investor_created_at,
    COALESCE((
      SELECT count(*)::integer
      FROM public.vlb_investments v
      WHERE v.investor_id = i.id
        AND v.status IN ('active', 'settlement')
    ), 0) AS active_investments_count
  FROM public.users u
  LEFT JOIN public.affiliates a ON a.user_id = u.id
  LEFT JOIN public.investors i ON i.user_id = u.id
  WHERE u.role = 'customer'
    AND (p_from IS NULL OR u.created_at >= p_from)
    AND (p_to IS NULL OR u.created_at < p_to)
    AND (
      p_search IS NULL OR btrim(p_search) = ''
      OR u.email ILIKE '%' || btrim(p_search) || '%'
      OR coalesce(u.full_name, '') ILIKE '%' || btrim(p_search) || '%'
      OR coalesce(u.first_name, '') ILIKE '%' || btrim(p_search) || '%'
      OR coalesce(u.last_name, '') ILIKE '%' || btrim(p_search) || '%'
      OR coalesce(u.phone, '') ILIKE '%' || btrim(p_search) || '%'
      OR u.id::text ILIKE '%' || btrim(p_search) || '%'
      OR coalesce(a.affiliate_no, '') ILIKE '%' || btrim(p_search) || '%'
      OR coalesce(i.investor_no, '') ILIKE '%' || btrim(p_search) || '%'
    )
    AND (
      coalesce(p_type, 'all') = 'all'
      OR (
        p_type = 'regular'
        AND a.id IS NULL
        AND i.id IS NULL
      )
      OR (
        p_type = 'affiliate'
        AND a.id IS NOT NULL
        AND (
          p_affiliate_status IS NULL
          OR btrim(p_affiliate_status) = ''
          OR a.status = p_affiliate_status
        )
      )
      OR (
        p_type = 'investor'
        AND i.id IS NOT NULL
        AND (
          p_investor_status IS NULL
          OR btrim(p_investor_status) = ''
          OR (
            p_investor_status = 'active'
            AND EXISTS (
              SELECT 1
              FROM public.vlb_investments v
              WHERE v.investor_id = i.id
                AND v.status IN ('active', 'settlement')
            )
          )
          OR (
            p_investor_status = 'past'
            AND EXISTS (
              SELECT 1
              FROM public.vlb_investments v
              WHERE v.investor_id = i.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.vlb_investments v
              WHERE v.investor_id = i.id
                AND v.status IN ('active', 'settlement')
            )
          )
        )
      )
    )
)
SELECT
  f.id,
  f.email,
  f.first_name,
  f.last_name,
  f.full_name,
  f.phone,
  f.created_at,
  f.newsletter_subscribed,
  (f.affiliate_id IS NOT NULL) AS is_affiliate,
  f.affiliate_id,
  f.affiliate_no,
  f.affiliate_status,
  f.affiliate_created_at,
  (f.investor_id IS NOT NULL) AS is_investor,
  f.investor_id,
  f.investor_no,
  f.investor_created_at,
  f.active_investments_count,
  (SELECT count(*) FROM filtered) AS total_count
FROM filtered f
ORDER BY
  CASE WHEN coalesce(p_sort, 'newest') = 'oldest' THEN f.created_at END ASC NULLS LAST,
  CASE WHEN coalesce(p_sort, 'newest') IS DISTINCT FROM 'oldest' THEN f.created_at END DESC NULLS LAST,
  f.id ASC
LIMIT greatest(1, least(coalesce(p_limit, 20), 10000))
OFFSET greatest(0, coalesce(p_offset, 0));
$fn$;

CREATE OR REPLACE FUNCTION public.admin_customer_type_counts(
  p_search text,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  all_count bigint,
  regular_count bigint,
  affiliate_count bigint,
  investor_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
WITH base AS (
  SELECT
    (a.id IS NOT NULL) AS is_affiliate,
    (i.id IS NOT NULL) AS is_investor
  FROM public.users u
  LEFT JOIN public.affiliates a ON a.user_id = u.id
  LEFT JOIN public.investors i ON i.user_id = u.id
  WHERE u.role = 'customer'
    AND (p_from IS NULL OR u.created_at >= p_from)
    AND (p_to IS NULL OR u.created_at < p_to)
    AND (
      p_search IS NULL OR btrim(p_search) = ''
      OR u.email ILIKE '%' || btrim(p_search) || '%'
      OR coalesce(u.full_name, '') ILIKE '%' || btrim(p_search) || '%'
      OR coalesce(u.first_name, '') ILIKE '%' || btrim(p_search) || '%'
      OR coalesce(u.last_name, '') ILIKE '%' || btrim(p_search) || '%'
      OR coalesce(u.phone, '') ILIKE '%' || btrim(p_search) || '%'
      OR u.id::text ILIKE '%' || btrim(p_search) || '%'
      OR coalesce(a.affiliate_no, '') ILIKE '%' || btrim(p_search) || '%'
      OR coalesce(i.investor_no, '') ILIKE '%' || btrim(p_search) || '%'
    )
)
SELECT
  count(*)::bigint AS all_count,
  count(*) FILTER (WHERE NOT is_affiliate AND NOT is_investor)::bigint AS regular_count,
  count(*) FILTER (WHERE is_affiliate)::bigint AS affiliate_count,
  count(*) FILTER (WHERE is_investor)::bigint AS investor_count
FROM base;
$fn$;

REVOKE ALL ON FUNCTION public.admin_list_customers(text, text, text, text, timestamptz, timestamptz, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_customers(text, text, text, text, timestamptz, timestamptz, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.admin_list_customers(text, text, text, text, timestamptz, timestamptz, text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_customers(text, text, text, text, timestamptz, timestamptz, text, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_customer_type_counts(text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_customer_type_counts(text, timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.admin_customer_type_counts(text, timestamptz, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_customer_type_counts(text, timestamptz, timestamptz) TO service_role;

COMMIT;
