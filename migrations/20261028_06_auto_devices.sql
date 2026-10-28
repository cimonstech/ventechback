-- Automatic pending devices for paid laptop orders.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

ALTER TABLE public.devices
  ALTER COLUMN serial_number DROP NOT NULL;

DROP INDEX IF EXISTS public.devices_serial_number_lower_idx;

CREATE UNIQUE INDEX devices_serial_number_lower_idx
  ON public.devices (lower(serial_number))
  WHERE serial_number IS NOT NULL;

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_status_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_status_check
  CHECK (status IN ('pending', 'active', 'transferred', 'retired'));

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_pending_serial_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_pending_serial_check
  CHECK (status = 'pending' OR serial_number IS NOT NULL);

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS unit_no int;

UPDATE public.devices AS d
SET unit_no = numbered.n
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY order_item_id ORDER BY created_at, id) AS n
  FROM public.devices
  WHERE order_item_id IS NOT NULL
    AND unit_no IS NULL
) AS numbered
WHERE d.id = numbered.id;

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_unit_no_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_unit_no_check
  CHECK (unit_no IS NULL OR unit_no >= 1);

CREATE UNIQUE INDEX IF NOT EXISTS devices_order_item_unit_uidx
  ON public.devices (order_item_id, unit_no)
  WHERE order_item_id IS NOT NULL AND unit_no IS NOT NULL;

INSERT INTO public.settings (key, value, category, description) VALUES
  (
    'device_registration_category_slugs',
    'laptops',
    'devices',
    'Category slugs (plus child categories) that create pending devices when an order is paid'
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;
