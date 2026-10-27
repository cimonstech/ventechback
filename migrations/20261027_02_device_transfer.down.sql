-- Rolls back 20261027_02_device_transfer.sql.

BEGIN;

ALTER TABLE public.devices
  DROP COLUMN owner_linked_at;

COMMIT;
