-- Registered devices and ownership claim codes.
-- Reuses public.update_updated_at_column() for updated_at.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

ALTER TABLE public.products
  ADD COLUMN warranty_months int
  CHECK (warranty_months IS NULL OR warranty_months BETWEEN 0 AND 120);

CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  customer_name text,
  customer_email text,
  customer_phone text,
  model_name text NOT NULL,
  serial_number text NOT NULL,
  purchase_date date NOT NULL,
  warranty_months int NOT NULL DEFAULT 0 CHECK (warranty_months BETWEEN 0 AND 120),
  warranty_start date NOT NULL,
  qr_token text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'transferred', 'retired')),
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX devices_serial_number_lower_idx
  ON public.devices (lower(serial_number));

CREATE UNIQUE INDEX devices_qr_token_idx
  ON public.devices (qr_token);

CREATE INDEX devices_user_id_idx
  ON public.devices (user_id);

CREATE INDEX devices_order_id_idx
  ON public.devices (order_id);

CREATE TABLE public.device_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_claims_device_id_user_id_created_at_idx
  ON public.device_claims (device_id, user_id, created_at DESC);

CREATE TRIGGER update_devices_updated_at
  BEFORE UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own devices"
  ON public.devices
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

COMMIT;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'products'
  AND column_name = 'warranty_months';

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('devices', 'device_claims')
ORDER BY c.relname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('devices', 'device_claims')
ORDER BY tablename, indexname;

SELECT tgname
FROM pg_trigger
WHERE tgrelid = 'public.devices'::regclass
  AND NOT tgisinternal;

SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('devices', 'device_claims')
ORDER BY tablename, policyname;
