--
-- PostgreSQL database dump
--

\restrict qVhjH2fNTUrzxj1ISKiMPCDHBYxl8DmwJmFx0zFIROdesJsS3VQuTLAEqgp962Z

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: calculate_tax(numeric, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_tax(amount numeric, tax_type character varying DEFAULT 'all'::character varying) RETURNS numeric
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  total_tax DECIMAL(10,2) := 0;
  tax_record RECORD;
BEGIN
  -- Get all active taxes that apply to the specified type
  FOR tax_record IN 
    SELECT rate, type 
    FROM taxes 
    WHERE is_active = TRUE 
    AND (applies_to = 'all' OR applies_to = tax_type)
  LOOP
    IF tax_record.type = 'percentage' THEN
      total_tax := total_tax + (amount * tax_record.rate);
    ELSIF tax_record.type = 'fixed' THEN
      total_tax := total_tax + tax_record.rate;
    END IF;
  END LOOP;
  
  RETURN ROUND(total_tax, 2);
END;
$$;


--
-- Name: generate_order_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_order_number() RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  new_order_number TEXT;
BEGIN
  new_order_number := 'VT' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(nextval('order_number_seq')::TEXT, 5, '0');
  RETURN new_order_number;
END;
$$;


--
-- Name: get_product_with_variants(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_product_with_variants(product_slug text) RETURNS json
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'product', row_to_json(p.*),
    'attributes', (
      SELECT json_agg(
        json_build_object(
          'attribute', row_to_json(pa.*),
          'options', (
            SELECT json_agg(row_to_json(pao.*))
            FROM product_attribute_options pao
            WHERE pao.attribute_id = pa.id
            AND pao.is_available = true
            ORDER BY pao.display_order
          )
        )
      )
      FROM product_attribute_mappings pam
      JOIN product_attributes pa ON pa.id = pam.attribute_id
      WHERE pam.product_id = p.id
      ORDER BY pam.display_order
    )
  ) INTO result
  FROM products p
  WHERE p.slug = product_slug;
  
  RETURN result;
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  first_name_val VARCHAR(255);
  last_name_val VARCHAR(255);
  full_name_val VARCHAR(255);
BEGIN
  -- Extract first_name and last_name from user_metadata
  first_name_val := COALESCE(
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'firstName',
    ''
  );
  
  last_name_val := COALESCE(
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'lastName',
    ''
  );
  
  -- Build full_name from first_name and last_name
  full_name_val := TRIM(CONCAT(first_name_val, ' ', last_name_val));
  
  -- Fallback to email if full_name is empty
  IF full_name_val = '' OR full_name_val IS NULL THEN
    full_name_val := COALESCE(
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.email
    );
  END IF;
  
  INSERT INTO public.users (id, email, first_name, last_name, full_name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(first_name_val, ''),
    NULLIF(last_name_val, ''),
    NULLIF(full_name_val, ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone, NULL),
    'customer'
  )
  ON CONFLICT (id) DO UPDATE SET
    first_name = COALESCE(EXCLUDED.first_name, users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, users.last_name),
    full_name = COALESCE(EXCLUDED.full_name, users.full_name),
    email = COALESCE(EXCLUDED.email, users.email),
    phone = COALESCE(EXCLUDED.phone, users.phone),
    updated_at = NOW();
  
  RETURN NEW;
END;
$$;


--
-- Name: increment_affiliate_link_clicks_all(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_affiliate_link_clicks_all(referral_code_param text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE affiliate_links
  SET clicks = clicks + 1, updated_at = NOW()
  WHERE referral_code = referral_code_param;
END;
$$;


--
-- Name: increment_affiliate_link_conversions_all(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_affiliate_link_conversions_all(referral_code_param text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE affiliate_links
  SET conversions = conversions + 1, updated_at = NOW()
  WHERE referral_code = referral_code_param;
END;
$$;


--
-- Name: increment_pending_earnings(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_pending_earnings(affiliate_id uuid, amount numeric) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE affiliates SET pending_earnings = pending_earnings + amount WHERE id = affiliate_id;
END;
$$;


--
-- Name: increment_total_clicks(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_total_clicks(affiliate_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE affiliates
  SET total_clicks = total_clicks + 1, updated_at = NOW()
  WHERE id = affiliate_id;
END;
$$;


--
-- Name: increment_total_conversions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_total_conversions(affiliate_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE affiliates
  SET total_conversions = total_conversions + 1, updated_at = NOW()
  WHERE id = affiliate_id;
END;
$$;


--
-- Name: is_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin(user_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM users 
    WHERE id = user_id 
    AND role = 'admin'
  );
END;
$$;


--
-- Name: protect_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_user_role() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.role := 'customer';
  elsif new.role is distinct from old.role
        and not public.is_admin(auth.uid()) then
    raise exception 'Not allowed to change role' using errcode = '42501';
  end if;

  return new;
end;
$$;


--
-- Name: record_coupon_usage(uuid, uuid, uuid, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_coupon_usage(coupon_id_param uuid, user_id_param uuid, order_id_param uuid, discount_amount_param numeric, order_total_param numeric) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Insert usage record
  INSERT INTO coupon_usage (
    coupon_id,
    user_id,
    order_id,
    discount_amount,
    order_total
  ) VALUES (
    coupon_id_param,
    user_id_param,
    order_id_param,
    discount_amount_param,
    order_total_param
  );

  -- Increment used_count in coupons table
  UPDATE coupons
  SET used_count = used_count + 1
  WHERE id = coupon_id_param;

  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$;


--
-- Name: FUNCTION record_coupon_usage(coupon_id_param uuid, user_id_param uuid, order_id_param uuid, discount_amount_param numeric, order_total_param numeric); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.record_coupon_usage(coupon_id_param uuid, user_id_param uuid, order_id_param uuid, discount_amount_param numeric, order_total_param numeric) IS 'Records coupon usage and increments the used_count';


--
-- Name: set_customers_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_customers_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: sync_product_brand(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_product_brand() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Update brand column from brands table when brand_id changes
  IF NEW.brand_id IS NOT NULL THEN
    SELECT name INTO NEW.brand
    FROM brands
    WHERE id = NEW.brand_id;
  ELSE
    NEW.brand = NULL;
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: update_affiliates_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_affiliates_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_click_logs_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_click_logs_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_coupons_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_coupons_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_deals_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_deals_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_delivery_options_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_delivery_options_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_earnings_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_earnings_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_notifications_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_notifications_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_payment_methods_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_payment_methods_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_payouts_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_payouts_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_product_rating(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_product_rating() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    -- Update the product's rating and review_count
    UPDATE products 
    SET 
        rating = (
            SELECT COALESCE(AVG(rating::DECIMAL), 0) 
            FROM reviews 
            WHERE product_id = COALESCE(NEW.product_id, OLD.product_id)
        ),
        review_count = (
            SELECT COUNT(*) 
            FROM reviews 
            WHERE product_id = COALESCE(NEW.product_id, OLD.product_id)
        )
    WHERE id = COALESCE(NEW.product_id, OLD.product_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: update_referral_links_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_referral_links_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_settings_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_settings_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_variant_stock_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_variant_stock_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: validate_coupon(text, numeric, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_coupon(coupon_code text, cart_amount numeric, user_id_param uuid DEFAULT NULL::uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  coupon_record RECORD;
  discount_amount DECIMAL(10, 2) := 0;
  usage_count INTEGER := 0;
  user_usage_count INTEGER := 0;
  is_valid BOOLEAN := false;
  error_message TEXT := '';
BEGIN
  -- Find the coupon
  SELECT * INTO coupon_record
  FROM coupons
  WHERE UPPER(code) = UPPER(coupon_code)
    AND is_active = true
    AND valid_from <= NOW()
    AND (valid_until IS NULL OR valid_until >= NOW());

  -- Check if coupon exists
  IF NOT FOUND THEN
    RETURN json_build_object(
      'is_valid', false,
      'discount_amount', 0,
      'error_message', 'Invalid coupon code'
    );
  END IF;

  -- Check minimum amount
  IF cart_amount < coupon_record.minimum_amount THEN
    RETURN json_build_object(
      'is_valid', false,
      'discount_amount', 0,
      'error_message', format('Minimum order amount of GHS %s required', coupon_record.minimum_amount)
    );
  END IF;

  -- Check total usage limit
  IF coupon_record.usage_limit IS NOT NULL THEN
    SELECT COUNT(*) INTO usage_count
    FROM coupon_usage
    WHERE coupon_id = coupon_record.id;

    IF usage_count >= coupon_record.usage_limit THEN
      RETURN json_build_object(
        'is_valid', false,
        'discount_amount', 0,
        'error_message', 'This coupon has reached its usage limit'
      );
    END IF;
  END IF;

  -- Check per-user usage limit
  IF user_id_param IS NOT NULL AND coupon_record.per_user_limit > 0 THEN
    SELECT COUNT(*) INTO user_usage_count
    FROM coupon_usage
    WHERE coupon_id = coupon_record.id
      AND user_id = user_id_param;

    IF user_usage_count >= coupon_record.per_user_limit THEN
      RETURN json_build_object(
        'is_valid', false,
        'discount_amount', 0,
        'error_message', 'You have already used this coupon the maximum number of times'
      );
    END IF;
  END IF;

  -- Calculate discount amount
  IF coupon_record.discount_type = 'percentage' THEN
    discount_amount := (cart_amount * coupon_record.discount_value) / 100;
    
    -- Apply maximum discount if set
    IF coupon_record.maximum_discount IS NOT NULL AND discount_amount > coupon_record.maximum_discount THEN
      discount_amount := coupon_record.maximum_discount;
    END IF;
  ELSIF coupon_record.discount_type = 'fixed_amount' THEN
    discount_amount := coupon_record.discount_value;
    
    -- Don't exceed cart amount
    IF discount_amount > cart_amount THEN
      discount_amount := cart_amount;
    END IF;
  ELSIF coupon_record.discount_type = 'free_shipping' THEN
    -- Free shipping - discount amount is 0, but coupon is valid
    discount_amount := 0;
  END IF;

  -- Return success
  RETURN json_build_object(
    'is_valid', true,
    'discount_amount', discount_amount,
    'error_message', '',
    'coupon_id', coupon_record.id,
    'coupon_name', coupon_record.name,
    'discount_type', coupon_record.discount_type,
    'applies_to', coupon_record.applies_to
  );
END;
$$;


--
-- Name: FUNCTION validate_coupon(coupon_code text, cart_amount numeric, user_id_param uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.validate_coupon(coupon_code text, cart_amount numeric, user_id_param uuid) IS 'Validates a coupon code and returns discount information';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_logs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    action text NOT NULL,
    user_id uuid,
    role text,
    status_code integer,
    duration_ms integer,
    ip_address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb
);


--
-- Name: affiliate_clicks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_clicks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    affiliate_id uuid NOT NULL,
    user_id uuid,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    link_id uuid,
    referral_code text
);


--
-- Name: affiliate_conversions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_conversions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    affiliate_id uuid NOT NULL,
    user_id uuid,
    amount numeric(12,2),
    currency text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: affiliate_earnings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_earnings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    affiliate_id uuid NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    product_name text,
    amount numeric DEFAULT 0,
    commission_rate numeric DEFAULT 0,
    status text DEFAULT 'pending'::text NOT NULL,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: affiliate_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    affiliate_id uuid NOT NULL,
    product_id uuid NOT NULL,
    referral_code text NOT NULL,
    generated_url text NOT NULL,
    clicks integer DEFAULT 0 NOT NULL,
    conversions integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: affiliates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    referral_code character varying(20) NOT NULL,
    tier character varying(50) DEFAULT 'starter'::character varying NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    total_earnings numeric(12,2) DEFAULT 0 NOT NULL,
    pending_earnings numeric(12,2) DEFAULT 0 NOT NULL,
    total_clicks integer DEFAULT 0 NOT NULL,
    total_conversions integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT affiliates_pending_earnings_check CHECK ((pending_earnings >= (0)::numeric)),
    CONSTRAINT affiliates_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'suspended'::character varying])::text[]))),
    CONSTRAINT affiliates_tier_check CHECK (((tier)::text = ANY ((ARRAY['starter'::character varying, 'pro'::character varying, 'elite'::character varying])::text[]))),
    CONSTRAINT affiliates_total_clicks_check CHECK ((total_clicks >= 0)),
    CONSTRAINT affiliates_total_conversions_check CHECK ((total_conversions >= 0)),
    CONSTRAINT affiliates_total_earnings_check CHECK ((total_earnings >= (0)::numeric))
);


--
-- Name: banners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banners (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    title character varying(255) NOT NULL,
    subtitle text,
    image_url text NOT NULL,
    link character varying(500),
    button_text character varying(50),
    active boolean DEFAULT true,
    "order" integer DEFAULT 0,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    text_color character varying(50)
);


--
-- Name: brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brands (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(100) NOT NULL,
    logo_url text,
    description text,
    website character varying(255),
    show_in_mega_menu boolean DEFAULT false,
    product_count integer DEFAULT 0,
    "order" integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    product_id uuid,
    quantity integer DEFAULT 1 NOT NULL,
    selected_variants jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(100) NOT NULL,
    description text,
    image_url text,
    parent_id uuid,
    show_in_mega_menu boolean DEFAULT false,
    mega_menu_column character varying(50),
    "order" integer DEFAULT 0,
    product_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: click_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.click_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referral_code character varying(20) NOT NULL,
    ip character varying(45),
    user_agent text,
    source character varying(100),
    converted boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: coupon_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupon_usage (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    coupon_id uuid NOT NULL,
    user_id uuid,
    order_id uuid,
    discount_amount numeric(10,2) NOT NULL,
    order_total numeric(10,2) NOT NULL,
    used_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE coupon_usage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.coupon_usage IS 'Tracks coupon usage by users to enforce per_user_limit';


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    discount_type character varying(50) NOT NULL,
    discount_value numeric(10,2) NOT NULL,
    minimum_amount numeric(10,2) DEFAULT 0,
    maximum_discount numeric(10,2),
    applies_to character varying(50) DEFAULT 'all'::character varying,
    usage_limit integer,
    used_count integer DEFAULT 0,
    per_user_limit integer DEFAULT 1,
    is_active boolean DEFAULT true,
    valid_from timestamp with time zone DEFAULT now(),
    valid_until timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT coupons_applies_to_check CHECK (((applies_to)::text = ANY ((ARRAY['all'::character varying, 'products'::character varying, 'shipping'::character varying, 'total'::character varying])::text[]))),
    CONSTRAINT coupons_discount_type_check CHECK (((discount_type)::text = ANY ((ARRAY['percentage'::character varying, 'fixed_amount'::character varying, 'free_shipping'::character varying])::text[]))),
    CONSTRAINT coupons_discount_value_check CHECK ((discount_value >= (0)::numeric)),
    CONSTRAINT coupons_maximum_discount_check CHECK ((maximum_discount >= (0)::numeric)),
    CONSTRAINT coupons_minimum_amount_check CHECK ((minimum_amount >= (0)::numeric)),
    CONSTRAINT coupons_per_user_limit_check CHECK ((per_user_limit > 0)),
    CONSTRAINT coupons_usage_limit_check CHECK ((usage_limit > 0)),
    CONSTRAINT coupons_used_count_check CHECK ((used_count >= 0))
);


--
-- Name: TABLE coupons; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.coupons IS 'Stores discount coupons that can be applied to orders';


--
-- Name: COLUMN coupons.discount_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.coupons.discount_type IS 'Type of discount: percentage, fixed_amount, or free_shipping';


--
-- Name: COLUMN coupons.discount_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.coupons.discount_value IS 'Discount amount (percentage or fixed amount in GHS)';


--
-- Name: COLUMN coupons.maximum_discount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.coupons.maximum_discount IS 'Maximum discount amount for percentage discounts (in GHS)';


--
-- Name: COLUMN coupons.applies_to; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.coupons.applies_to IS 'What the discount applies to: all, products, shipping, or total';


--
-- Name: COLUMN coupons.usage_limit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.coupons.usage_limit IS 'Total number of times this coupon can be used (NULL = unlimited)';


--
-- Name: COLUMN coupons.per_user_limit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.coupons.per_user_limit IS 'Number of times a single user can use this coupon';


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    full_name text,
    email text,
    phone text,
    source text DEFAULT 'manual'::text,
    notes text,
    created_by uuid,
    last_order_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deal_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_products (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    deal_id uuid NOT NULL,
    product_id uuid,
    deal_price numeric(10,2),
    discount_percentage integer DEFAULT 0,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    is_flash_deal boolean DEFAULT false,
    product_name character varying(255),
    product_description text,
    product_image_url text,
    original_price numeric(10,2),
    product_images text[],
    product_key_features text,
    product_specifications jsonb,
    stock_quantity integer DEFAULT 0,
    CONSTRAINT deal_products_discount_percentage_check CHECK (((discount_percentage >= 0) AND (discount_percentage <= 100))),
    CONSTRAINT deal_products_product_check CHECK (((product_id IS NOT NULL) OR ((product_name IS NOT NULL) AND (original_price IS NOT NULL)))),
    CONSTRAINT deal_products_stock_quantity_check CHECK ((stock_quantity >= 0))
);


--
-- Name: deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deals (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    banner_image_url text,
    discount_percentage integer DEFAULT 0,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_flash_deal boolean DEFAULT false,
    CONSTRAINT deals_discount_percentage_check CHECK (((discount_percentage >= 0) AND (discount_percentage <= 100))),
    CONSTRAINT valid_date_range CHECK ((end_date > start_date))
);


--
-- Name: delivery_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    price numeric(10,2) DEFAULT 0 NOT NULL,
    estimated_days integer,
    is_active boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    type character varying(20) DEFAULT 'delivery'::character varying,
    CONSTRAINT delivery_options_type_check CHECK (((type)::text = ANY (ARRAY[('delivery'::character varying)::text, ('pickup'::character varying)::text])))
);


--
-- Name: COLUMN delivery_options.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.delivery_options.type IS 'Type of option: delivery or pickup';


--
-- Name: discounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    type character varying(20) NOT NULL,
    value numeric(10,2) NOT NULL,
    minimum_amount numeric(10,2) DEFAULT 0,
    maximum_discount numeric(10,2),
    is_active boolean DEFAULT true,
    valid_from timestamp with time zone DEFAULT now(),
    valid_until timestamp with time zone,
    usage_limit integer,
    used_count integer DEFAULT 0,
    applies_to character varying(50) DEFAULT 'all'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT discounts_applies_to_check CHECK (((applies_to)::text = ANY (ARRAY[('all'::character varying)::text, ('products'::character varying)::text, ('shipping'::character varying)::text, ('total'::character varying)::text]))),
    CONSTRAINT discounts_type_check CHECK (((type)::text = ANY (ARRAY[('percentage'::character varying)::text, ('fixed_amount'::character varying)::text, ('free_shipping'::character varying)::text])))
);


--
-- Name: earnings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.earnings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    affiliate_id uuid NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_name character varying(255),
    amount numeric(12,2) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT earnings_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT earnings_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'paid'::character varying])::text[])))
);


--
-- Name: media_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_library (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    url text NOT NULL,
    filename character varying(255) NOT NULL,
    folder character varying(100) NOT NULL,
    size bigint NOT NULL,
    mime_type character varying(100) NOT NULL,
    file_hash character varying(64),
    width integer,
    height integer,
    alt_text text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE media_library; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.media_library IS 'Centralized media library for all uploaded images in R2 storage';


--
-- Name: COLUMN media_library.file_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.media_library.file_hash IS 'SHA-256 hash of file content for deduplication';


--
-- Name: mega_menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mega_menu_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    parent_id uuid,
    title character varying(100) NOT NULL,
    type character varying(50),
    link character varying(500),
    icon character varying(100),
    image_url text,
    category_id uuid,
    brand_id uuid,
    column_number integer DEFAULT 1,
    "order" integer DEFAULT 0,
    show_badge boolean DEFAULT false,
    badge_text character varying(50),
    badge_color character varying(50),
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT mega_menu_items_type_check CHECK (((type)::text = ANY (ARRAY[('category'::character varying)::text, ('brand'::character varying)::text, ('link'::character varying)::text, ('banner'::character varying)::text])))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    is_read boolean DEFAULT false,
    action_url character varying(500),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notifications_type_check CHECK (((type)::text = ANY (ARRAY[('order'::character varying)::text, ('stock'::character varying)::text, ('user'::character varying)::text, ('alert'::character varying)::text, ('success'::character varying)::text, ('payment'::character varying)::text, ('review'::character varying)::text])))
);


--
-- Name: TABLE notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notifications IS 'Stores notifications for admin users';


--
-- Name: COLUMN notifications.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.type IS 'Type of notification: order, stock, user, alert, success, payment, review';


--
-- Name: COLUMN notifications.is_read; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.is_read IS 'Whether the notification has been read';


--
-- Name: COLUMN notifications.action_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.action_url IS 'Optional URL to navigate to when notification is clicked';


--
-- Name: COLUMN notifications.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.metadata IS 'Additional data related to the notification (JSON)';


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    order_id uuid,
    product_id uuid,
    product_name character varying(255) NOT NULL,
    product_image text,
    selected_variants jsonb,
    quantity integer NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    total_price numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    deal_product_id uuid,
    deal_snapshot jsonb
);


--
-- Name: order_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    order_number character varying(50) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying,
    subtotal numeric(10,2) NOT NULL,
    discount numeric(10,2) DEFAULT 0,
    tax numeric(10,2) DEFAULT 0,
    shipping_fee numeric(10,2) DEFAULT 0,
    total numeric(10,2) NOT NULL,
    payment_method character varying(50),
    payment_status character varying(50) DEFAULT 'pending'::character varying,
    shipping_address jsonb NOT NULL,
    billing_address jsonb,
    tracking_number character varying(100),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    discount_code text,
    customer_id uuid,
    customer_bio jsonb,
    CONSTRAINT orders_payment_status_check CHECK (((payment_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('paid'::character varying)::text, ('failed'::character varying)::text, ('refunded'::character varying)::text]))),
    CONSTRAINT orders_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('shipped'::character varying)::text, ('delivered'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: COLUMN orders.customer_bio; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.customer_bio IS 'Customer identification information (name, email, phone) for both guest and registered customers';


--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    affiliate_id uuid NOT NULL,
    type character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    details text NOT NULL,
    is_default boolean DEFAULT false,
    is_verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT payment_methods_type_check CHECK (((type)::text = ANY ((ARRAY['bank'::character varying, 'momo'::character varying, 'crypto'::character varying])::text[])))
);


--
-- Name: payout_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    affiliate_id uuid NOT NULL,
    method_type text,
    account_name text,
    account_number text,
    provider text,
    is_default boolean DEFAULT false,
    is_verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: payout_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    affiliate_id uuid NOT NULL,
    amount numeric,
    status text DEFAULT 'pending'::text NOT NULL,
    payout_method_id uuid,
    method text,
    reference text,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    affiliate_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    method character varying(50),
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    reference character varying(255),
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT payouts_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT payouts_method_check CHECK (((method)::text = ANY ((ARRAY['bank'::character varying, 'momo'::character varying, 'crypto'::character varying])::text[]))),
    CONSTRAINT payouts_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying])::text[])))
);


--
-- Name: product_attribute_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_attribute_mappings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    product_id uuid,
    attribute_id uuid,
    is_required boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_attribute_option_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_attribute_option_mappings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    product_id uuid NOT NULL,
    attribute_id uuid NOT NULL,
    option_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    stock_quantity integer DEFAULT 0,
    is_available boolean DEFAULT true
);


--
-- Name: product_attribute_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_attribute_options (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    attribute_id uuid,
    value character varying(100) NOT NULL,
    label character varying(100) NOT NULL,
    price_modifier numeric(10,2) DEFAULT 0,
    stock_quantity integer DEFAULT 0,
    sku_suffix character varying(50),
    display_order integer DEFAULT 0,
    is_available boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_attributes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_attributes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(100) NOT NULL,
    type character varying(50) NOT NULL,
    display_order integer DEFAULT 0,
    is_required boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_brands (
    product_id uuid NOT NULL,
    brand_id uuid NOT NULL
);


--
-- Name: product_selected_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_selected_options (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    product_id uuid NOT NULL,
    attribute_id uuid NOT NULL,
    option_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_variant_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variant_stock (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    product_id uuid NOT NULL,
    variant_combination jsonb NOT NULL,
    stock_quantity integer DEFAULT 0 NOT NULL,
    sku character varying(100),
    is_available boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    product_id uuid,
    type character varying(50) NOT NULL,
    value character varying(100) NOT NULL,
    label character varying(100) NOT NULL,
    price_adjustment numeric(10,2) DEFAULT 0,
    in_stock boolean DEFAULT true,
    "order" integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    description text,
    category_id uuid,
    brand_id uuid,
    price numeric(10,2) NOT NULL,
    discount_price numeric(10,2),
    discount_percentage integer,
    in_stock boolean DEFAULT true,
    stock_quantity integer DEFAULT 0,
    images text[],
    thumbnail text,
    is_featured boolean DEFAULT false,
    rating numeric(3,2) DEFAULT 0.0,
    review_count integer DEFAULT 0,
    specs jsonb,
    features text[],
    sku character varying(100),
    weight numeric(10,2),
    dimensions jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    rating_count integer DEFAULT 0,
    reviews_count integer DEFAULT 0,
    is_flash_deal boolean DEFAULT false,
    flash_deal_start timestamp with time zone,
    flash_deal_end timestamp with time zone,
    flash_deal_discount integer DEFAULT 0,
    flash_deal_price numeric(10,2),
    key_features text,
    specifications text,
    is_pre_order boolean DEFAULT false,
    pre_order_available boolean DEFAULT false,
    estimated_arrival_date timestamp with time zone,
    key_specs jsonb DEFAULT '[]'::jsonb,
    brand character varying(255)
);


--
-- Name: COLUMN products.key_features; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.key_features IS 'Key features as JSON array string (e.g., ["Fast processor", "Long battery life"])';


--
-- Name: COLUMN products.specifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.specifications IS 'Product specifications as JSON object string (e.g., {"processor": "Intel i7", "ram": "16GB"})';


--
-- Name: COLUMN products.is_pre_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.is_pre_order IS 'Indicates if this product is available for pre-order';


--
-- Name: COLUMN products.pre_order_available; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.pre_order_available IS 'Indicates if pre-orders are currently open for this product';


--
-- Name: COLUMN products.estimated_arrival_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.estimated_arrival_date IS 'Estimated arrival date for pre-order items (optional)';


--
-- Name: COLUMN products.key_specs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.key_specs IS 'Array of key specifications with label and color. Max 6 items. Format: [{"label": "string", "color": "hex_color"}]';


--
-- Name: COLUMN products.brand; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.brand IS 'Brand name as text (for search). Should be kept in sync with brands table via brand_id.';


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    banner_image_url text,
    link character varying(500),
    type character varying(50),
    target_page character varying(100),
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT promotions_type_check CHECK (((type)::text = ANY (ARRAY[('banner'::character varying)::text, ('popup'::character varying)::text, ('badge'::character varying)::text])))
);


--
-- Name: referral_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    affiliate_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    url text NOT NULL,
    short_url character varying(255),
    source character varying(100),
    clicks integer DEFAULT 0 NOT NULL,
    conversions integer DEFAULT 0 NOT NULL,
    earnings numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT referral_links_clicks_check CHECK ((clicks >= 0)),
    CONSTRAINT referral_links_conversions_check CHECK ((conversions >= 0)),
    CONSTRAINT referral_links_earnings_check CHECK ((earnings >= (0)::numeric))
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    product_id uuid,
    user_id uuid,
    rating integer NOT NULL,
    title character varying(255),
    comment text,
    images text[],
    verified_purchase boolean DEFAULT false,
    helpful_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_approved boolean DEFAULT true,
    is_verified_purchase boolean DEFAULT false,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    key character varying(100) NOT NULL,
    value text,
    category character varying(50) NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid
);


--
-- Name: sidebar_ads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sidebar_ads (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    title character varying(255),
    image_url text NOT NULL,
    link character varying(500) NOT NULL,
    "position" character varying(10) DEFAULT 'right'::character varying,
    show_on jsonb DEFAULT '["homepage"]'::jsonb,
    slider_group uuid,
    active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    click_count integer DEFAULT 0,
    impression_count integer DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sidebar_ads_position_check CHECK ((("position")::text = ANY (ARRAY[('left'::character varying)::text, ('right'::character varying)::text])))
);


--
-- Name: taxes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.taxes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    rate numeric(5,4) NOT NULL,
    type character varying(20) NOT NULL,
    is_active boolean DEFAULT true,
    applies_to character varying(50) DEFAULT 'all'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT taxes_applies_to_check CHECK (((applies_to)::text = ANY (ARRAY[('all'::character varying)::text, ('products'::character varying)::text, ('shipping'::character varying)::text, ('total'::character varying)::text]))),
    CONSTRAINT taxes_rate_check CHECK (((rate >= (0)::numeric) AND (rate <= (1)::numeric))),
    CONSTRAINT taxes_type_check CHECK (((type)::text = ANY (ARRAY[('percentage'::character varying)::text, ('fixed'::character varying)::text])))
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    order_id uuid,
    user_id uuid,
    transaction_reference character varying(255) NOT NULL,
    payment_method character varying(50) NOT NULL,
    payment_provider character varying(50) DEFAULT 'paystack'::character varying,
    amount numeric(10,2) NOT NULL,
    currency character varying(3) DEFAULT 'GHS'::character varying,
    status character varying(50) DEFAULT 'pending'::character varying,
    payment_status character varying(50) DEFAULT 'pending'::character varying,
    paystack_reference character varying(255),
    authorization_code character varying(255),
    channel character varying(50),
    customer_email character varying(255) NOT NULL,
    customer_code character varying(255),
    metadata jsonb DEFAULT '{}'::jsonb,
    initiated_at timestamp with time zone DEFAULT now(),
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT transactions_payment_method_check CHECK (((payment_method)::text = ANY (ARRAY[('paystack'::character varying)::text, ('cash_on_delivery'::character varying)::text, ('mobile_money'::character varying)::text, ('card'::character varying)::text]))),
    CONSTRAINT transactions_payment_status_check CHECK (((payment_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('paid'::character varying)::text, ('failed'::character varying)::text, ('refunded'::character varying)::text]))),
    CONSTRAINT transactions_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('success'::character varying)::text, ('failed'::character varying)::text, ('cancelled'::character varying)::text, ('refunded'::character varying)::text])))
);


--
-- Name: TABLE transactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.transactions IS 'Tracks all payment transactions for orders - used for analytics, sales tracking, and financial reporting';


--
-- Name: COLUMN transactions.amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.amount IS 'Amount in pesewas (GHS * 100) for Paystack, or actual amount for other methods';


--
-- Name: COLUMN transactions.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.metadata IS 'Additional payment data including checkout_data, user details, etc.';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(20),
    avatar_url text,
    role character varying(20) DEFAULT 'customer'::character varying,
    email_verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    first_name character varying(255),
    last_name character varying(255),
    shipping_address jsonb DEFAULT '{}'::jsonb,
    billing_address jsonb DEFAULT '{}'::jsonb,
    date_of_birth date,
    gender character varying(20),
    newsletter_subscribed boolean DEFAULT false,
    sms_notifications boolean DEFAULT true,
    email_notifications boolean DEFAULT true,
    full_name character varying(255),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY (ARRAY[('customer'::character varying)::text, ('admin'::character varying)::text, ('superadmin'::character varying)::text])))
);


--
-- Name: COLUMN users.first_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.first_name IS 'User first name';


--
-- Name: COLUMN users.last_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.last_name IS 'User last name';


--
-- Name: COLUMN users.shipping_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.shipping_address IS 'User shipping address as JSON';


--
-- Name: COLUMN users.billing_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.billing_address IS 'User billing address as JSON';


--
-- Name: COLUMN users.date_of_birth; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.date_of_birth IS 'User date of birth';


--
-- Name: COLUMN users.gender; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.gender IS 'User gender';


--
-- Name: COLUMN users.newsletter_subscribed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.newsletter_subscribed IS 'User subscription to newsletter and promotional emails';


--
-- Name: COLUMN users.sms_notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.sms_notifications IS 'User preference for SMS notifications';


--
-- Name: COLUMN users.email_notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.email_notifications IS 'User preference for email notifications';


--
-- Name: wishlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wishlists (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    product_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: admin_logs admin_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_logs
    ADD CONSTRAINT admin_logs_pkey PRIMARY KEY (id);


--
-- Name: affiliate_clicks affiliate_clicks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_clicks
    ADD CONSTRAINT affiliate_clicks_pkey PRIMARY KEY (id);


--
-- Name: affiliate_conversions affiliate_conversions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_conversions
    ADD CONSTRAINT affiliate_conversions_pkey PRIMARY KEY (id);


--
-- Name: affiliate_earnings affiliate_earnings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_earnings
    ADD CONSTRAINT affiliate_earnings_pkey PRIMARY KEY (id);


--
-- Name: affiliate_links affiliate_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_links
    ADD CONSTRAINT affiliate_links_pkey PRIMARY KEY (id);


--
-- Name: affiliates affiliates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliates
    ADD CONSTRAINT affiliates_pkey PRIMARY KEY (id);


--
-- Name: affiliates affiliates_referral_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliates
    ADD CONSTRAINT affiliates_referral_code_key UNIQUE (referral_code);


--
-- Name: affiliates affiliates_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliates
    ADD CONSTRAINT affiliates_user_id_key UNIQUE (user_id);


--
-- Name: banners banners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banners
    ADD CONSTRAINT banners_pkey PRIMARY KEY (id);


--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);


--
-- Name: brands brands_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_slug_key UNIQUE (slug);


--
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_pkey PRIMARY KEY (id);


--
-- Name: cart_items cart_items_user_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_user_id_product_id_key UNIQUE (user_id, product_id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: categories categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_slug_key UNIQUE (slug);


--
-- Name: click_logs click_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.click_logs
    ADD CONSTRAINT click_logs_pkey PRIMARY KEY (id);


--
-- Name: coupon_usage coupon_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_usage
    ADD CONSTRAINT coupon_usage_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: customers customers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_email_key UNIQUE (email);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: deal_products deal_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_products
    ADD CONSTRAINT deal_products_pkey PRIMARY KEY (id);


--
-- Name: deals deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);


--
-- Name: delivery_options delivery_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_options
    ADD CONSTRAINT delivery_options_pkey PRIMARY KEY (id);


--
-- Name: discounts discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discounts
    ADD CONSTRAINT discounts_pkey PRIMARY KEY (id);


--
-- Name: earnings earnings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings
    ADD CONSTRAINT earnings_pkey PRIMARY KEY (id);


--
-- Name: media_library media_library_file_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_library
    ADD CONSTRAINT media_library_file_hash_key UNIQUE (file_hash);


--
-- Name: media_library media_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_library
    ADD CONSTRAINT media_library_pkey PRIMARY KEY (id);


--
-- Name: media_library media_library_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_library
    ADD CONSTRAINT media_library_url_key UNIQUE (url);


--
-- Name: mega_menu_items mega_menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mega_menu_items
    ADD CONSTRAINT mega_menu_items_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);


--
-- Name: payout_methods payout_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_methods
    ADD CONSTRAINT payout_methods_pkey PRIMARY KEY (id);


--
-- Name: payout_requests payout_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_requests
    ADD CONSTRAINT payout_requests_pkey PRIMARY KEY (id);


--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);


--
-- Name: product_attribute_mappings product_attribute_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_mappings
    ADD CONSTRAINT product_attribute_mappings_pkey PRIMARY KEY (id);


--
-- Name: product_attribute_mappings product_attribute_mappings_product_id_attribute_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_mappings
    ADD CONSTRAINT product_attribute_mappings_product_id_attribute_id_key UNIQUE (product_id, attribute_id);


--
-- Name: product_attribute_option_mappings product_attribute_option_mapp_product_id_attribute_id_optio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_option_mappings
    ADD CONSTRAINT product_attribute_option_mapp_product_id_attribute_id_optio_key UNIQUE (product_id, attribute_id, option_id);


--
-- Name: product_attribute_option_mappings product_attribute_option_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_option_mappings
    ADD CONSTRAINT product_attribute_option_mappings_pkey PRIMARY KEY (id);


--
-- Name: product_attribute_options product_attribute_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_options
    ADD CONSTRAINT product_attribute_options_pkey PRIMARY KEY (id);


--
-- Name: product_attributes product_attributes_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attributes
    ADD CONSTRAINT product_attributes_name_key UNIQUE (name);


--
-- Name: product_attributes product_attributes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attributes
    ADD CONSTRAINT product_attributes_pkey PRIMARY KEY (id);


--
-- Name: product_attributes product_attributes_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attributes
    ADD CONSTRAINT product_attributes_slug_key UNIQUE (slug);


--
-- Name: product_brands product_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_brands
    ADD CONSTRAINT product_brands_pkey PRIMARY KEY (product_id, brand_id);


--
-- Name: product_selected_options product_selected_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_selected_options
    ADD CONSTRAINT product_selected_options_pkey PRIMARY KEY (id);


--
-- Name: product_selected_options product_selected_options_product_id_attribute_id_option_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_selected_options
    ADD CONSTRAINT product_selected_options_product_id_attribute_id_option_id_key UNIQUE (product_id, attribute_id, option_id);


--
-- Name: product_variant_stock product_variant_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant_stock
    ADD CONSTRAINT product_variant_stock_pkey PRIMARY KEY (id);


--
-- Name: product_variant_stock product_variant_stock_product_id_variant_combination_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant_stock
    ADD CONSTRAINT product_variant_stock_product_id_variant_combination_key UNIQUE (product_id, variant_combination);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);


--
-- Name: products products_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_slug_key UNIQUE (slug);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: referral_links referral_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_links
    ADD CONSTRAINT referral_links_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_product_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_product_id_user_id_key UNIQUE (product_id, user_id);


--
-- Name: settings settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_key_key UNIQUE (key);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: sidebar_ads sidebar_ads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sidebar_ads
    ADD CONSTRAINT sidebar_ads_pkey PRIMARY KEY (id);


--
-- Name: taxes taxes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taxes
    ADD CONSTRAINT taxes_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_transaction_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_transaction_reference_key UNIQUE (transaction_reference);


--
-- Name: affiliate_links unique_affiliate_product_link; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_links
    ADD CONSTRAINT unique_affiliate_product_link UNIQUE (affiliate_id, product_id);


--
-- Name: delivery_options unique_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_options
    ADD CONSTRAINT unique_name UNIQUE (name);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: wishlists wishlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_pkey PRIMARY KEY (id);


--
-- Name: wishlists wishlists_user_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_user_id_product_id_key UNIQUE (user_id, product_id);


--
-- Name: admin_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_logs_created_at_idx ON public.admin_logs USING btree (created_at DESC);


--
-- Name: admin_logs_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_logs_user_idx ON public.admin_logs USING btree (user_id);


--
-- Name: deal_products_deal_id_product_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX deal_products_deal_id_product_id_unique ON public.deal_products USING btree (deal_id, product_id) WHERE (product_id IS NOT NULL);


--
-- Name: idx_affiliate_clicks_affiliate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_clicks_affiliate_id ON public.affiliate_clicks USING btree (affiliate_id);


--
-- Name: idx_affiliate_clicks_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_clicks_created_at ON public.affiliate_clicks USING btree (created_at);


--
-- Name: idx_affiliate_clicks_link_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_clicks_link_id ON public.affiliate_clicks USING btree (link_id);


--
-- Name: idx_affiliate_clicks_referral_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_clicks_referral_code ON public.affiliate_clicks USING btree (referral_code);


--
-- Name: idx_affiliate_conversions_affiliate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_conversions_affiliate_id ON public.affiliate_conversions USING btree (affiliate_id);


--
-- Name: idx_affiliate_conversions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_conversions_created_at ON public.affiliate_conversions USING btree (created_at);


--
-- Name: idx_affiliate_earnings_affiliate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_earnings_affiliate_id ON public.affiliate_earnings USING btree (affiliate_id);


--
-- Name: idx_affiliate_earnings_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_earnings_created_at ON public.affiliate_earnings USING btree (created_at);


--
-- Name: idx_affiliate_earnings_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_earnings_order_id ON public.affiliate_earnings USING btree (order_id);


--
-- Name: idx_affiliate_earnings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_earnings_status ON public.affiliate_earnings USING btree (status);


--
-- Name: idx_affiliate_links_affiliate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_links_affiliate_id ON public.affiliate_links USING btree (affiliate_id);


--
-- Name: idx_affiliate_links_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_links_created_at ON public.affiliate_links USING btree (created_at);


--
-- Name: idx_affiliate_links_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_links_product_id ON public.affiliate_links USING btree (product_id);


--
-- Name: idx_affiliate_links_referral_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_links_referral_code ON public.affiliate_links USING btree (referral_code);


--
-- Name: idx_affiliates_referral_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliates_referral_code ON public.affiliates USING btree (referral_code);


--
-- Name: idx_affiliates_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliates_status ON public.affiliates USING btree (status);


--
-- Name: idx_affiliates_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliates_user_id ON public.affiliates USING btree (user_id);


--
-- Name: idx_banners_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_banners_active ON public.banners USING btree (active);


--
-- Name: idx_banners_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_banners_order ON public.banners USING btree ("order");


--
-- Name: idx_brands_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brands_order ON public.brands USING btree ("order");


--
-- Name: idx_brands_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brands_slug ON public.brands USING btree (slug);


--
-- Name: idx_cart_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cart_product ON public.cart_items USING btree (product_id);


--
-- Name: idx_cart_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cart_user ON public.cart_items USING btree (user_id);


--
-- Name: idx_categories_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_order ON public.categories USING btree ("order");


--
-- Name: idx_categories_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_parent ON public.categories USING btree (parent_id);


--
-- Name: idx_categories_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_slug ON public.categories USING btree (slug);


--
-- Name: idx_click_logs_converted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_click_logs_converted ON public.click_logs USING btree (converted);


--
-- Name: idx_click_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_click_logs_created_at ON public.click_logs USING btree (created_at);


--
-- Name: idx_click_logs_referral_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_click_logs_referral_code ON public.click_logs USING btree (referral_code);


--
-- Name: idx_coupon_usage_coupon; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_usage_coupon ON public.coupon_usage USING btree (coupon_id);


--
-- Name: idx_coupon_usage_coupon_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_usage_coupon_user ON public.coupon_usage USING btree (coupon_id, user_id);


--
-- Name: idx_coupon_usage_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_usage_order ON public.coupon_usage USING btree (order_id);


--
-- Name: idx_coupon_usage_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupon_usage_user ON public.coupon_usage USING btree (user_id);


--
-- Name: idx_coupons_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_active ON public.coupons USING btree (is_active, valid_from, valid_until);


--
-- Name: idx_coupons_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_code ON public.coupons USING btree (code);


--
-- Name: idx_coupons_validity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_validity ON public.coupons USING btree (valid_from, valid_until) WHERE (is_active = true);


--
-- Name: idx_deal_products_deal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_products_deal_id ON public.deal_products USING btree (deal_id);


--
-- Name: idx_deal_products_is_flash_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_products_is_flash_deal ON public.deal_products USING btree (is_flash_deal, deal_id);


--
-- Name: idx_deal_products_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_products_product_id ON public.deal_products USING btree (product_id);


--
-- Name: idx_deal_products_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_products_sort_order ON public.deal_products USING btree (deal_id, sort_order);


--
-- Name: idx_deals_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_active ON public.deals USING btree (is_active, start_date, end_date);


--
-- Name: idx_deals_display_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_display_order ON public.deals USING btree (display_order);


--
-- Name: idx_deals_is_flash_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_is_flash_deal ON public.deals USING btree (is_flash_deal, is_active, start_date, end_date);


--
-- Name: idx_delivery_options_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_options_active ON public.delivery_options USING btree (is_active);


--
-- Name: idx_delivery_options_display_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_options_display_order ON public.delivery_options USING btree (display_order);


--
-- Name: idx_discounts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discounts_active ON public.discounts USING btree (is_active);


--
-- Name: idx_discounts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discounts_type ON public.discounts USING btree (type);


--
-- Name: idx_discounts_valid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discounts_valid ON public.discounts USING btree (valid_from, valid_until);


--
-- Name: idx_earnings_affiliate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_earnings_affiliate_id ON public.earnings USING btree (affiliate_id);


--
-- Name: idx_earnings_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_earnings_created_at ON public.earnings USING btree (created_at);


--
-- Name: idx_earnings_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_earnings_order_id ON public.earnings USING btree (order_id);


--
-- Name: idx_earnings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_earnings_status ON public.earnings USING btree (status);


--
-- Name: idx_media_library_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_library_created ON public.media_library USING btree (created_at DESC);


--
-- Name: idx_media_library_folder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_library_folder ON public.media_library USING btree (folder);


--
-- Name: idx_media_library_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_library_hash ON public.media_library USING btree (file_hash);


--
-- Name: idx_media_library_url; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_library_url ON public.media_library USING btree (url);


--
-- Name: idx_mega_menu_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mega_menu_active ON public.mega_menu_items USING btree (active);


--
-- Name: idx_mega_menu_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mega_menu_order ON public.mega_menu_items USING btree ("order");


--
-- Name: idx_mega_menu_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mega_menu_parent ON public.mega_menu_items USING btree (parent_id);


--
-- Name: idx_mega_menu_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mega_menu_type ON public.mega_menu_items USING btree (type);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notifications_is_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_is_read ON public.notifications USING btree (is_read);


--
-- Name: idx_notifications_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_type ON public.notifications USING btree (type);


--
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_product ON public.order_items USING btree (product_id);


--
-- Name: idx_orders_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created ON public.orders USING btree (created_at);


--
-- Name: idx_orders_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_number ON public.orders USING btree (order_number);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- Name: idx_orders_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);


--
-- Name: idx_payment_methods_affiliate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_methods_affiliate_id ON public.payment_methods USING btree (affiliate_id);


--
-- Name: idx_payout_methods_affiliate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_methods_affiliate_id ON public.payout_methods USING btree (affiliate_id);


--
-- Name: idx_payout_methods_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_methods_created_at ON public.payout_methods USING btree (created_at);


--
-- Name: idx_payout_methods_method_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_methods_method_type ON public.payout_methods USING btree (method_type);


--
-- Name: idx_payout_requests_affiliate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_requests_affiliate_id ON public.payout_requests USING btree (affiliate_id);


--
-- Name: idx_payout_requests_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_requests_created_at ON public.payout_requests USING btree (created_at);


--
-- Name: idx_payout_requests_payout_method_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_requests_payout_method_id ON public.payout_requests USING btree (payout_method_id);


--
-- Name: idx_payout_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payout_requests_status ON public.payout_requests USING btree (status);


--
-- Name: idx_payouts_affiliate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payouts_affiliate_id ON public.payouts USING btree (affiliate_id);


--
-- Name: idx_payouts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payouts_created_at ON public.payouts USING btree (created_at);


--
-- Name: idx_payouts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payouts_status ON public.payouts USING btree (status);


--
-- Name: idx_product_attribute_mappings_attribute; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_attribute_mappings_attribute ON public.product_attribute_mappings USING btree (attribute_id);


--
-- Name: idx_product_attribute_mappings_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_attribute_mappings_product ON public.product_attribute_mappings USING btree (product_id);


--
-- Name: idx_product_attribute_option_mappings_attribute; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_attribute_option_mappings_attribute ON public.product_attribute_option_mappings USING btree (attribute_id);


--
-- Name: idx_product_attribute_option_mappings_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_attribute_option_mappings_composite ON public.product_attribute_option_mappings USING btree (product_id, attribute_id);


--
-- Name: idx_product_attribute_option_mappings_option; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_attribute_option_mappings_option ON public.product_attribute_option_mappings USING btree (option_id);


--
-- Name: idx_product_attribute_option_mappings_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_attribute_option_mappings_product ON public.product_attribute_option_mappings USING btree (product_id);


--
-- Name: idx_product_attribute_options_attribute; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_attribute_options_attribute ON public.product_attribute_options USING btree (attribute_id);


--
-- Name: idx_product_attribute_options_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_attribute_options_available ON public.product_attribute_options USING btree (is_available);


--
-- Name: idx_product_selected_options_attribute; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_selected_options_attribute ON public.product_selected_options USING btree (attribute_id);


--
-- Name: idx_product_selected_options_option; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_selected_options_option ON public.product_selected_options USING btree (option_id);


--
-- Name: idx_product_selected_options_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_selected_options_product ON public.product_selected_options USING btree (product_id);


--
-- Name: idx_products_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_brand ON public.products USING btree (brand_id);


--
-- Name: idx_products_brand_text; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_brand_text ON public.products USING btree (brand);


--
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category ON public.products USING btree (category_id);


--
-- Name: idx_products_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_created ON public.products USING btree (created_at);


--
-- Name: idx_products_featured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_featured ON public.products USING btree (is_featured);


--
-- Name: idx_products_flash_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_flash_deal ON public.products USING btree (is_flash_deal, flash_deal_end);


--
-- Name: idx_products_is_featured_in_stock_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_is_featured_in_stock_created ON public.products USING btree (is_featured, in_stock, created_at DESC) WHERE ((is_featured = true) AND (in_stock = true));


--
-- Name: idx_products_is_featured_no_preorder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_is_featured_no_preorder ON public.products USING btree (created_at DESC) WHERE ((is_featured = true) AND (in_stock = true) AND ((is_pre_order = false) OR (is_pre_order IS NULL)));


--
-- Name: idx_products_is_featured_partial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_is_featured_partial ON public.products USING btree (created_at DESC, in_stock) WHERE (is_featured = true);


--
-- Name: idx_products_key_specs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_key_specs ON public.products USING gin (key_specs);


--
-- Name: idx_products_pre_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_pre_order ON public.products USING btree (is_pre_order, pre_order_available) WHERE ((is_pre_order = true) AND (pre_order_available = true));


--
-- Name: idx_products_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_price ON public.products USING btree (price);


--
-- Name: idx_products_rating; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_rating ON public.products USING btree (rating);


--
-- Name: idx_products_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_slug ON public.products USING btree (slug);


--
-- Name: idx_products_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_stock ON public.products USING btree (in_stock);


--
-- Name: idx_referral_links_affiliate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_links_affiliate_id ON public.referral_links USING btree (affiliate_id);


--
-- Name: idx_referral_links_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_links_source ON public.referral_links USING btree (source);


--
-- Name: idx_reviews_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_created_at ON public.reviews USING btree (created_at DESC);


--
-- Name: idx_reviews_is_approved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_is_approved ON public.reviews USING btree (is_approved);


--
-- Name: idx_reviews_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_product ON public.reviews USING btree (product_id);


--
-- Name: idx_reviews_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_product_id ON public.reviews USING btree (product_id);


--
-- Name: idx_reviews_rating; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_rating ON public.reviews USING btree (rating);


--
-- Name: idx_reviews_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_user ON public.reviews USING btree (user_id);


--
-- Name: idx_reviews_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_user_id ON public.reviews USING btree (user_id);


--
-- Name: idx_sidebar_ads_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sidebar_ads_active ON public.sidebar_ads USING btree (active);


--
-- Name: idx_sidebar_ads_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sidebar_ads_order ON public.sidebar_ads USING btree (sort_order);


--
-- Name: idx_sidebar_ads_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sidebar_ads_position ON public.sidebar_ads USING btree ("position");


--
-- Name: idx_taxes_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxes_active ON public.taxes USING btree (is_active);


--
-- Name: idx_taxes_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taxes_type ON public.taxes USING btree (type);


--
-- Name: idx_transactions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_created_at ON public.transactions USING btree (created_at);


--
-- Name: idx_transactions_customer_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_customer_email ON public.transactions USING btree (customer_email);


--
-- Name: idx_transactions_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_order ON public.transactions USING btree (order_id);


--
-- Name: idx_transactions_paid_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_paid_at ON public.transactions USING btree (paid_at);


--
-- Name: idx_transactions_payment_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_payment_method ON public.transactions USING btree (payment_method);


--
-- Name: idx_transactions_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_payment_status ON public.transactions USING btree (payment_status);


--
-- Name: idx_transactions_paystack_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_paystack_ref ON public.transactions USING btree (paystack_reference);


--
-- Name: idx_transactions_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_reference ON public.transactions USING btree (transaction_reference);


--
-- Name: idx_transactions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_status ON public.transactions USING btree (status);


--
-- Name: idx_transactions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_user ON public.transactions USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_gender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_gender ON public.users USING btree (gender);


--
-- Name: idx_users_newsletter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_newsletter ON public.users USING btree (newsletter_subscribed);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_variant_stock_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variant_stock_available ON public.product_variant_stock USING btree (is_available) WHERE (is_available = true);


--
-- Name: idx_variant_stock_combination; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variant_stock_combination ON public.product_variant_stock USING gin (variant_combination);


--
-- Name: idx_variant_stock_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variant_stock_product ON public.product_variant_stock USING btree (product_id);


--
-- Name: idx_variants_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_product ON public.product_variants USING btree (product_id);


--
-- Name: idx_variants_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_type ON public.product_variants USING btree (type);


--
-- Name: idx_wishlist_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wishlist_product ON public.wishlists USING btree (product_id);


--
-- Name: idx_wishlist_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wishlist_user ON public.wishlists USING btree (user_id);


--
-- Name: orders_discount_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_discount_code_idx ON public.orders USING btree (discount_code);


--
-- Name: users protect_user_role; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER protect_user_role BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.protect_user_role();


--
-- Name: customers trg_customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_customers_updated_at();


--
-- Name: affiliates trg_update_affiliates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_affiliates_updated_at BEFORE UPDATE ON public.affiliates FOR EACH ROW EXECUTE FUNCTION public.update_affiliates_updated_at();


--
-- Name: click_logs trg_update_click_logs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_click_logs_updated_at BEFORE UPDATE ON public.click_logs FOR EACH ROW EXECUTE FUNCTION public.update_click_logs_updated_at();


--
-- Name: earnings trg_update_earnings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_earnings_updated_at BEFORE UPDATE ON public.earnings FOR EACH ROW EXECUTE FUNCTION public.update_earnings_updated_at();


--
-- Name: payment_methods trg_update_payment_methods_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_payment_methods_updated_at BEFORE UPDATE ON public.payment_methods FOR EACH ROW EXECUTE FUNCTION public.update_payment_methods_updated_at();


--
-- Name: payouts trg_update_payouts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_payouts_updated_at BEFORE UPDATE ON public.payouts FOR EACH ROW EXECUTE FUNCTION public.update_payouts_updated_at();


--
-- Name: referral_links trg_update_referral_links_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_referral_links_updated_at BEFORE UPDATE ON public.referral_links FOR EACH ROW EXECUTE FUNCTION public.update_referral_links_updated_at();


--
-- Name: delivery_options trigger_delivery_options_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_delivery_options_updated_at BEFORE UPDATE ON public.delivery_options FOR EACH ROW EXECUTE FUNCTION public.update_delivery_options_updated_at();


--
-- Name: products trigger_sync_product_brand; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_sync_product_brand BEFORE INSERT OR UPDATE OF brand_id ON public.products FOR EACH ROW EXECUTE FUNCTION public.sync_product_brand();


--
-- Name: affiliate_clicks trigger_update_affiliate_clicks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_affiliate_clicks_updated_at BEFORE UPDATE ON public.affiliate_clicks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: affiliate_earnings trigger_update_affiliate_earnings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_affiliate_earnings_updated_at BEFORE UPDATE ON public.affiliate_earnings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: affiliate_links trigger_update_affiliate_links_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_affiliate_links_updated_at BEFORE UPDATE ON public.affiliate_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: coupons trigger_update_coupons_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_coupons_updated_at BEFORE UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.update_coupons_updated_at();


--
-- Name: payout_methods trigger_update_payout_methods_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_payout_methods_updated_at BEFORE UPDATE ON public.payout_methods FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: payout_requests trigger_update_payout_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_payout_requests_updated_at BEFORE UPDATE ON public.payout_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: reviews trigger_update_product_rating_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_product_rating_delete AFTER DELETE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_product_rating();


--
-- Name: reviews trigger_update_product_rating_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_product_rating_insert AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_product_rating();


--
-- Name: reviews trigger_update_product_rating_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_product_rating_update AFTER UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_product_rating();


--
-- Name: settings trigger_update_settings_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_settings_timestamp BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.update_settings_timestamp();


--
-- Name: banners update_banners_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_banners_updated_at BEFORE UPDATE ON public.banners FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: brands update_brands_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_brands_updated_at BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: cart_items update_cart_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_cart_items_updated_at BEFORE UPDATE ON public.cart_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: categories update_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: deals update_deals_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_deals_timestamp BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.update_deals_updated_at();


--
-- Name: mega_menu_items update_mega_menu_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_mega_menu_items_updated_at BEFORE UPDATE ON public.mega_menu_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: notifications update_notifications_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.update_notifications_updated_at();


--
-- Name: orders update_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: products update_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: promotions update_promotions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_promotions_updated_at BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: reviews update_reviews_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: sidebar_ads update_sidebar_ads_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_sidebar_ads_updated_at BEFORE UPDATE ON public.sidebar_ads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: product_variant_stock update_variant_stock_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_variant_stock_timestamp BEFORE UPDATE ON public.product_variant_stock FOR EACH ROW EXECUTE FUNCTION public.update_variant_stock_updated_at();


--
-- Name: affiliates affiliates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliates
    ADD CONSTRAINT affiliates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: cart_items cart_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: cart_items cart_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: categories categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: coupon_usage coupon_usage_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_usage
    ADD CONSTRAINT coupon_usage_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;


--
-- Name: coupon_usage coupon_usage_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_usage
    ADD CONSTRAINT coupon_usage_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: coupon_usage coupon_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_usage
    ADD CONSTRAINT coupon_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: coupons coupons_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: customers customers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: customers customers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: deal_products deal_products_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_products
    ADD CONSTRAINT deal_products_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;


--
-- Name: deal_products deal_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_products
    ADD CONSTRAINT deal_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: earnings earnings_affiliate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings
    ADD CONSTRAINT earnings_affiliate_id_fkey FOREIGN KEY (affiliate_id) REFERENCES public.affiliates(id) ON DELETE CASCADE;


--
-- Name: earnings earnings_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings
    ADD CONSTRAINT earnings_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: earnings earnings_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings
    ADD CONSTRAINT earnings_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: affiliate_clicks fk_affiliate_clicks_link; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_clicks
    ADD CONSTRAINT fk_affiliate_clicks_link FOREIGN KEY (link_id) REFERENCES public.affiliate_links(id) ON DELETE SET NULL;


--
-- Name: affiliate_earnings fk_affiliate_earnings_affiliate; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_earnings
    ADD CONSTRAINT fk_affiliate_earnings_affiliate FOREIGN KEY (affiliate_id) REFERENCES public.affiliates(id) ON DELETE CASCADE;


--
-- Name: affiliate_earnings fk_affiliate_earnings_order; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_earnings
    ADD CONSTRAINT fk_affiliate_earnings_order FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: affiliate_links fk_affiliate_links_affiliate; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_links
    ADD CONSTRAINT fk_affiliate_links_affiliate FOREIGN KEY (affiliate_id) REFERENCES public.affiliates(id) ON DELETE CASCADE;


--
-- Name: affiliate_links fk_affiliate_links_product; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_links
    ADD CONSTRAINT fk_affiliate_links_product FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: payout_methods fk_payout_methods_affiliate; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_methods
    ADD CONSTRAINT fk_payout_methods_affiliate FOREIGN KEY (affiliate_id) REFERENCES public.affiliates(id) ON DELETE CASCADE;


--
-- Name: payout_requests fk_payout_requests_affiliate; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_requests
    ADD CONSTRAINT fk_payout_requests_affiliate FOREIGN KEY (affiliate_id) REFERENCES public.affiliates(id) ON DELETE CASCADE;


--
-- Name: payout_requests fk_payout_requests_method; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_requests
    ADD CONSTRAINT fk_payout_requests_method FOREIGN KEY (payout_method_id) REFERENCES public.payout_methods(id) ON DELETE SET NULL;


--
-- Name: mega_menu_items mega_menu_items_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mega_menu_items
    ADD CONSTRAINT mega_menu_items_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: mega_menu_items mega_menu_items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mega_menu_items
    ADD CONSTRAINT mega_menu_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: mega_menu_items mega_menu_items_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mega_menu_items
    ADD CONSTRAINT mega_menu_items_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.mega_menu_items(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_deal_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_deal_product_id_fkey FOREIGN KEY (deal_product_id) REFERENCES public.deal_products(id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payment_methods payment_methods_affiliate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_affiliate_id_fkey FOREIGN KEY (affiliate_id) REFERENCES public.affiliates(id) ON DELETE CASCADE;


--
-- Name: payouts payouts_affiliate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_affiliate_id_fkey FOREIGN KEY (affiliate_id) REFERENCES public.affiliates(id) ON DELETE CASCADE;


--
-- Name: product_attribute_mappings product_attribute_mappings_attribute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_mappings
    ADD CONSTRAINT product_attribute_mappings_attribute_id_fkey FOREIGN KEY (attribute_id) REFERENCES public.product_attributes(id) ON DELETE CASCADE;


--
-- Name: product_attribute_mappings product_attribute_mappings_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_mappings
    ADD CONSTRAINT product_attribute_mappings_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_attribute_option_mappings product_attribute_option_mappings_attribute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_option_mappings
    ADD CONSTRAINT product_attribute_option_mappings_attribute_id_fkey FOREIGN KEY (attribute_id) REFERENCES public.product_attributes(id) ON DELETE CASCADE;


--
-- Name: product_attribute_option_mappings product_attribute_option_mappings_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_option_mappings
    ADD CONSTRAINT product_attribute_option_mappings_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.product_attribute_options(id) ON DELETE CASCADE;


--
-- Name: product_attribute_option_mappings product_attribute_option_mappings_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_option_mappings
    ADD CONSTRAINT product_attribute_option_mappings_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_attribute_options product_attribute_options_attribute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attribute_options
    ADD CONSTRAINT product_attribute_options_attribute_id_fkey FOREIGN KEY (attribute_id) REFERENCES public.product_attributes(id) ON DELETE CASCADE;


--
-- Name: product_brands product_brands_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_brands
    ADD CONSTRAINT product_brands_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;


--
-- Name: product_brands product_brands_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_brands
    ADD CONSTRAINT product_brands_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_selected_options product_selected_options_attribute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_selected_options
    ADD CONSTRAINT product_selected_options_attribute_id_fkey FOREIGN KEY (attribute_id) REFERENCES public.product_attributes(id) ON DELETE CASCADE;


--
-- Name: product_selected_options product_selected_options_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_selected_options
    ADD CONSTRAINT product_selected_options_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.product_attribute_options(id) ON DELETE CASCADE;


--
-- Name: product_selected_options product_selected_options_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_selected_options
    ADD CONSTRAINT product_selected_options_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_variant_stock product_variant_stock_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant_stock
    ADD CONSTRAINT product_variant_stock_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: referral_links referral_links_affiliate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_links
    ADD CONSTRAINT referral_links_affiliate_id_fkey FOREIGN KEY (affiliate_id) REFERENCES public.affiliates(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: settings settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: sidebar_ads sidebar_ads_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sidebar_ads
    ADD CONSTRAINT sidebar_ads_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: wishlists wishlists_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: wishlists wishlists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlists
    ADD CONSTRAINT wishlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reviews Admins can delete any review; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete any review" ON public.reviews FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: notifications Admins can delete notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete notifications" ON public.notifications FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: orders Admins can delete orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete orders" ON public.orders FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: reviews Admins can manage all reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage all reviews" ON public.reviews USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = ANY ((ARRAY['admin'::character varying, 'superadmin'::character varying])::text[]))))));


--
-- Name: product_attribute_options Admins can manage attribute options; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage attribute options" ON public.product_attribute_options TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: banners Admins can manage banners; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage banners" ON public.banners USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: brands Admins can manage brands; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage brands" ON public.brands USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: categories Admins can manage categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage categories" ON public.categories USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: deal_products Admins can manage deal products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage deal products" ON public.deal_products TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: deals Admins can manage deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage deals" ON public.deals TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: delivery_options Admins can manage delivery options; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage delivery options" ON public.delivery_options TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: discounts Admins can manage discounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage discounts" ON public.discounts TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: media_library Admins can manage media; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage media" ON public.media_library TO authenticated USING (( SELECT public.is_admin(auth.uid()) AS is_admin)) WITH CHECK (( SELECT public.is_admin(auth.uid()) AS is_admin));


--
-- Name: mega_menu_items Admins can manage mega menu items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage mega menu items" ON public.mega_menu_items USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: product_attribute_mappings Admins can manage product attribute mappings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage product attribute mappings" ON public.product_attribute_mappings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: product_attribute_option_mappings Admins can manage product attribute option mappings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage product attribute option mappings" ON public.product_attribute_option_mappings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: product_attribute_options Admins can manage product attribute options; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage product attribute options" ON public.product_attribute_options USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = ANY ((ARRAY['admin'::character varying, 'superadmin'::character varying])::text[]))))));


--
-- Name: product_attributes Admins can manage product attributes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage product attributes" ON public.product_attributes TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: product_selected_options Admins can manage product selected options; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage product selected options" ON public.product_selected_options TO authenticated USING (( SELECT public.is_admin(auth.uid()) AS is_admin)) WITH CHECK (( SELECT public.is_admin(auth.uid()) AS is_admin));


--
-- Name: product_variants Admins can manage product variants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage product variants" ON public.product_variants USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: products Admins can manage products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage products" ON public.products USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: promotions Admins can manage promotions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage promotions" ON public.promotions USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: settings Admins can manage settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage settings" ON public.settings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: sidebar_ads Admins can manage sidebar ads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage sidebar ads" ON public.sidebar_ads USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: taxes Admins can manage taxes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage taxes" ON public.taxes TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: transactions Admins can manage transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage transactions" ON public.transactions TO authenticated USING (( SELECT public.is_admin(auth.uid()) AS is_admin)) WITH CHECK (( SELECT public.is_admin(auth.uid()) AS is_admin));


--
-- Name: product_variant_stock Admins can manage variant stock; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage variant stock" ON public.product_variant_stock TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: orders Admins can update all orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update all orders" ON public.orders FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: users Admins can update all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update all users" ON public.users FOR UPDATE USING (((auth.uid() = id) OR public.is_admin(auth.uid())));


--
-- Name: notifications Admins can update notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update notifications" ON public.notifications FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: banners Admins can view all banners; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all banners" ON public.banners FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: deal_products Admins can view all deal products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all deal products" ON public.deal_products FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: deals Admins can view all deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all deals" ON public.deals FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: notifications Admins can view all notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all notifications" ON public.notifications FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: order_items Admins can view all order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all order items" ON public.order_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: POLICY "Admins can view all order items" ON order_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "Admins can view all order items" ON public.order_items IS 'Allows admin users to view order items for all orders';


--
-- Name: orders Admins can view all orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all orders" ON public.orders FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: reviews Admins can view all reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all reviews" ON public.reviews FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: users Admins can view all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all users" ON public.users FOR SELECT USING (((auth.uid() = id) OR public.is_admin(auth.uid())));


--
-- Name: wishlists Admins can view all wishlists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all wishlists" ON public.wishlists FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text)))));


--
-- Name: affiliate_links Affiliates can insert own links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Affiliates can insert own links" ON public.affiliate_links FOR INSERT WITH CHECK ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid()))));


--
-- Name: payout_methods Affiliates can insert own payout methods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Affiliates can insert own payout methods" ON public.payout_methods FOR INSERT WITH CHECK ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid()))));


--
-- Name: payout_requests Affiliates can insert own payout requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Affiliates can insert own payout requests" ON public.payout_requests FOR INSERT WITH CHECK ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid()))));


--
-- Name: affiliate_clicks Affiliates can select own clicks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Affiliates can select own clicks" ON public.affiliate_clicks FOR SELECT USING ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid()))));


--
-- Name: affiliate_earnings Affiliates can select own earnings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Affiliates can select own earnings" ON public.affiliate_earnings FOR SELECT USING ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid()))));


--
-- Name: affiliate_links Affiliates can select own links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Affiliates can select own links" ON public.affiliate_links FOR SELECT USING ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid()))));


--
-- Name: payout_methods Affiliates can select own payout methods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Affiliates can select own payout methods" ON public.payout_methods FOR SELECT USING ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid()))));


--
-- Name: payout_requests Affiliates can select own payout requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Affiliates can select own payout requests" ON public.payout_requests FOR SELECT USING ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid()))));


--
-- Name: affiliate_links Affiliates can update own links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Affiliates can update own links" ON public.affiliate_links FOR UPDATE USING ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid())))) WITH CHECK ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid()))));


--
-- Name: payout_methods Affiliates can update own payout methods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Affiliates can update own payout methods" ON public.payout_methods FOR UPDATE USING ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid())))) WITH CHECK ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid()))));


--
-- Name: payout_requests Affiliates can update own payout requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Affiliates can update own payout requests" ON public.payout_requests FOR UPDATE USING ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid())))) WITH CHECK ((affiliate_id = ( SELECT affiliates.id
   FROM public.affiliates
  WHERE (affiliates.user_id = auth.uid()))));


--
-- Name: banners Anyone can view active banners; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active banners" ON public.banners FOR SELECT USING ((active = true));


--
-- Name: mega_menu_items Anyone can view active mega menu items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active mega menu items" ON public.mega_menu_items FOR SELECT USING ((active = true));


--
-- Name: promotions Anyone can view active promotions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active promotions" ON public.promotions FOR SELECT USING ((active = true));


--
-- Name: sidebar_ads Anyone can view active sidebar ads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active sidebar ads" ON public.sidebar_ads FOR SELECT USING ((active = true));


--
-- Name: brands Anyone can view brands; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view brands" ON public.brands FOR SELECT USING (true);


--
-- Name: categories Anyone can view categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view categories" ON public.categories FOR SELECT USING (true);


--
-- Name: product_variants Anyone can view product variants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view product variants" ON public.product_variants FOR SELECT USING (true);


--
-- Name: products Anyone can view products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view products" ON public.products FOR SELECT USING (true);


--
-- Name: reviews Anyone can view reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view reviews" ON public.reviews FOR SELECT USING (true);


--
-- Name: deals Public can view active deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view active deals" ON public.deals FOR SELECT USING (((is_active = true) AND (start_date <= now()) AND (end_date >= now())));


--
-- Name: delivery_options Public can view active delivery options; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view active delivery options" ON public.delivery_options FOR SELECT USING ((is_active = true));


--
-- Name: discounts Public can view active discounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view active discounts" ON public.discounts FOR SELECT USING (((is_active = true) AND (valid_from <= now()) AND ((valid_until IS NULL) OR (valid_until >= now())) AND ((usage_limit IS NULL) OR (used_count < usage_limit))));


--
-- Name: taxes Public can view active taxes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view active taxes" ON public.taxes FOR SELECT USING ((is_active = true));


--
-- Name: reviews Public can view approved reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view approved reviews" ON public.reviews FOR SELECT USING ((is_approved = true));


--
-- Name: product_attribute_options Public can view attribute options; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view attribute options" ON public.product_attribute_options FOR SELECT USING (true);


--
-- Name: product_variant_stock Public can view available variant stock; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view available variant stock" ON public.product_variant_stock FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.products
  WHERE ((products.id = product_variant_stock.product_id) AND (products.in_stock = true)))) AND (is_available = true)));


--
-- Name: deal_products Public can view deal products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view deal products" ON public.deal_products FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.deals
  WHERE ((deals.id = deal_products.deal_id) AND (deals.is_active = true) AND (deals.start_date <= now()) AND (deals.end_date >= now())))));


--
-- Name: product_attribute_mappings Public can view product attribute mappings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view product attribute mappings" ON public.product_attribute_mappings FOR SELECT USING (true);


--
-- Name: product_attribute_option_mappings Public can view product attribute option mappings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view product attribute option mappings" ON public.product_attribute_option_mappings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.products
  WHERE ((products.id = product_attribute_option_mappings.product_id) AND (products.in_stock = true)))));


--
-- Name: product_attribute_options Public can view product attribute options; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view product attribute options" ON public.product_attribute_options FOR SELECT USING (true);


--
-- Name: product_attributes Public can view product attributes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view product attributes" ON public.product_attributes FOR SELECT USING (true);


--
-- Name: product_selected_options Public can view product selected options; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view product selected options" ON public.product_selected_options FOR SELECT USING (true);


--
-- Name: reviews Public can view reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view reviews" ON public.reviews FOR SELECT USING (true);


--
-- Name: settings Public can view settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view settings" ON public.settings FOR SELECT USING (true);


--
-- Name: coupons Service role has full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role has full access" ON public.coupons TO service_role USING (true);


--
-- Name: coupon_usage Service role has full access to coupon usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role has full access to coupon usage" ON public.coupon_usage TO service_role USING (true);


--
-- Name: reviews Users can create reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create reviews" ON public.reviews FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: reviews Users can delete own reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own reviews" ON public.reviews FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: wishlists Users can delete own wishlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own wishlist" ON public.wishlists FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: reviews Users can delete their own reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own reviews" ON public.reviews FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: wishlists Users can insert own wishlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own wishlist" ON public.wishlists FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: reviews Users can insert their own reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own reviews" ON public.reviews FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: cart_items Users can manage own cart; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own cart" ON public.cart_items USING ((auth.uid() = user_id));


--
-- Name: wishlists Users can manage own wishlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own wishlist" ON public.wishlists USING ((auth.uid() = user_id));


--
-- Name: reviews Users can update own reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own reviews" ON public.reviews FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: reviews Users can update their own reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own reviews" ON public.reviews FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: cart_items Users can view own cart; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own cart" ON public.cart_items FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: order_items Users can view own order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own order items" ON public.order_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = order_items.order_id) AND (orders.user_id = auth.uid())))));


--
-- Name: orders Users can view own orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own orders" ON public.orders FOR SELECT USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND ((users.role)::text = 'admin'::text))))));


--
-- Name: wishlists Users can view own wishlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own wishlist" ON public.wishlists FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: coupon_usage Users can view their own coupon usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own coupon usage" ON public.coupon_usage FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: order_items Users can view their own order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own order items" ON public.order_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = order_items.order_id) AND (orders.user_id = auth.uid())))));


--
-- Name: POLICY "Users can view their own order items" ON order_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "Users can view their own order items" ON public.order_items IS 'Allows users to view order items for their own orders';


--
-- Name: reviews Users can view their own reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own reviews" ON public.reviews FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: admin_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: affiliate_clicks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.affiliate_clicks ENABLE ROW LEVEL SECURITY;

--
-- Name: affiliate_conversions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.affiliate_conversions ENABLE ROW LEVEL SECURITY;

--
-- Name: affiliate_earnings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.affiliate_earnings ENABLE ROW LEVEL SECURITY;

--
-- Name: affiliate_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.affiliate_links ENABLE ROW LEVEL SECURITY;

--
-- Name: affiliates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;

--
-- Name: banners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

--
-- Name: brands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

--
-- Name: cart_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: click_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.click_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: coupon_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coupon_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: coupons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_products ENABLE ROW LEVEL SECURITY;

--
-- Name: deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_options ENABLE ROW LEVEL SECURITY;

--
-- Name: discounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discounts ENABLE ROW LEVEL SECURITY;

--
-- Name: earnings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.earnings ENABLE ROW LEVEL SECURITY;

--
-- Name: media_library; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.media_library ENABLE ROW LEVEL SECURITY;

--
-- Name: mega_menu_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mega_menu_items ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_methods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

--
-- Name: payout_methods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payout_methods ENABLE ROW LEVEL SECURITY;

--
-- Name: payout_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: payouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

--
-- Name: product_attribute_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_attribute_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: product_attribute_option_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_attribute_option_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: product_attribute_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_attribute_options ENABLE ROW LEVEL SECURITY;

--
-- Name: product_attributes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;

--
-- Name: product_brands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_brands ENABLE ROW LEVEL SECURITY;

--
-- Name: product_selected_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_selected_options ENABLE ROW LEVEL SECURITY;

--
-- Name: product_variant_stock; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_variant_stock ENABLE ROW LEVEL SECURITY;

--
-- Name: product_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: referral_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.referral_links ENABLE ROW LEVEL SECURITY;

--
-- Name: reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: users service_role_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all ON public.users TO service_role USING (true) WITH CHECK (true);


--
-- Name: users service_role_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_insert ON public.users FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

--
-- Name: sidebar_ads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sidebar_ads ENABLE ROW LEVEL SECURITY;

--
-- Name: taxes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.taxes ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_policy ON public.users FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));


--
-- Name: users users_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_own ON public.users FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: users users_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_own ON public.users FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));


--
-- Name: wishlists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict qVhjH2fNTUrzxj1ISKiMPCDHBYxl8DmwJmFx0zFIROdesJsS3VQuTLAEqgp962Z

