-- Rolls back 20261027_01_devices.sql.
-- Drops device_claims, then devices, then products.warranty_months.

BEGIN;

DROP TABLE public.device_claims;
DROP TABLE public.devices;

ALTER TABLE public.products
  DROP COLUMN warranty_months;

COMMIT;
