BEGIN;

DELETE FROM public.devices
WHERE status = 'pending'
   OR serial_number IS NULL;

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_pending_serial_check;

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_status_check;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_status_check
  CHECK (status IN ('active', 'transferred', 'retired'));

DROP INDEX IF EXISTS public.devices_order_item_unit_uidx;

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_unit_no_check;

ALTER TABLE public.devices
  DROP COLUMN IF EXISTS unit_no;

DROP INDEX IF EXISTS public.devices_serial_number_lower_idx;

CREATE UNIQUE INDEX devices_serial_number_lower_idx
  ON public.devices (lower(serial_number));

ALTER TABLE public.devices
  ALTER COLUMN serial_number SET NOT NULL;

DELETE FROM public.settings
WHERE key = 'device_registration_category_slugs';

COMMIT;
