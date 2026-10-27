BEGIN;

ALTER TABLE public.ticket_events DROP CONSTRAINT IF EXISTS ticket_events_type_check;
ALTER TABLE public.ticket_events
  ADD CONSTRAINT ticket_events_type_check
  CHECK (type IN ('created', 'status', 'reply', 'note', 'assigned', 'resolution'));

ALTER TABLE public.service_tickets
  DROP CONSTRAINT IF EXISTS service_tickets_repair_paid_amount_check,
  DROP CONSTRAINT IF EXISTS service_tickets_repair_paid_method_check,
  DROP COLUMN IF EXISTS repair_paid_amount,
  DROP COLUMN IF EXISTS repair_paid_method,
  DROP COLUMN IF EXISTS repair_paid_reference,
  DROP COLUMN IF EXISTS repair_paid_at,
  DROP COLUMN IF EXISTS repair_paid_by;

COMMIT;
