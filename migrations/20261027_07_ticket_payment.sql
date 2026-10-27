-- Repair payment fields and extra ticket event types.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

ALTER TABLE public.service_tickets
  ADD COLUMN IF NOT EXISTS repair_paid_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS repair_paid_method text,
  ADD COLUMN IF NOT EXISTS repair_paid_reference text,
  ADD COLUMN IF NOT EXISTS repair_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS repair_paid_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.service_tickets
  DROP CONSTRAINT IF EXISTS service_tickets_repair_paid_amount_check,
  DROP CONSTRAINT IF EXISTS service_tickets_repair_paid_method_check;

ALTER TABLE public.service_tickets
  ADD CONSTRAINT service_tickets_repair_paid_amount_check
    CHECK (repair_paid_amount IS NULL OR repair_paid_amount >= 0),
  ADD CONSTRAINT service_tickets_repair_paid_method_check
    CHECK (repair_paid_method IS NULL OR repair_paid_method IN ('cash', 'momo', 'card', 'bank_transfer'));

ALTER TABLE public.ticket_events DROP CONSTRAINT IF EXISTS ticket_events_type_check;
ALTER TABLE public.ticket_events
  ADD CONSTRAINT ticket_events_type_check
  CHECK (type IN ('created', 'status', 'reply', 'note', 'assigned', 'resolution', 'warranty', 'repair_cost', 'payment'));

COMMIT;
