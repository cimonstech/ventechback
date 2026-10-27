-- When the current owner was linked to the device.
-- Apply in the database SQL editor. Do not run this file from the app.

BEGIN;

ALTER TABLE public.devices
  ADD COLUMN owner_linked_at timestamptz;

COMMIT;
