-- Service tickets, issue types, uploads, and the ticket event log.
-- Reuses public.update_updated_at_column() for updated_at.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

CREATE SEQUENCE public.service_ticket_no_seq START 1;

CREATE TABLE public.ticket_issue_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed issue types. Safe to re-run on a fresh database: existing names are left unchanged.
INSERT INTO public.ticket_issue_types (name, sort_order) VALUES
  ('Overheating', 1),
  ('Not charging', 2),
  ('Windows crashing', 3),
  ('Slow performance', 4),
  ('Wi-Fi problems', 5),
  ('Other', 6)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE public.service_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no text NOT NULL UNIQUE DEFAULT ('VT-SRV-' || lpad(nextval('public.service_ticket_no_seq')::text, 6, '0')),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  order_number_text text,
  issue_type_id uuid NOT NULL REFERENCES public.ticket_issue_types(id) ON DELETE RESTRICT,
  contact_name text NOT NULL,
  contact_phone text NOT NULL,
  laptop_model text NOT NULL,
  serial_number text,
  date_started date NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'diagnosing', 'repair_resolution', 'ready', 'completed', 'closed')),
  closed_reason text,
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  is_warranty boolean,
  warranty_status_at_submit text CHECK (warranty_status_at_submit IN ('active', 'expired', 'none', 'unknown')),
  resolution text,
  repair_cost numeric(10,2) CHECK (repair_cost IS NULL OR repair_cost >= 0),
  repair_paid boolean NOT NULL DEFAULT false,
  last_customer_activity_at timestamptz,
  last_staff_activity_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_tickets_closed_reason_check CHECK (status <> 'closed' OR closed_reason IS NOT NULL)
);

CREATE INDEX service_tickets_user_id_created_at_idx
  ON public.service_tickets (user_id, created_at DESC);

CREATE INDEX service_tickets_status_created_at_idx
  ON public.service_tickets (status, created_at);

CREATE INDEX service_tickets_assigned_to_idx
  ON public.service_tickets (assigned_to);

CREATE INDEX service_tickets_device_id_idx
  ON public.service_tickets (device_id);

CREATE TABLE public.ticket_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.service_tickets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  r2_key text NOT NULL UNIQUE,
  mime text NOT NULL,
  size_bytes int NOT NULL CHECK (size_bytes > 0),
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'receipt')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ticket_media_ticket_id_idx
  ON public.ticket_media (ticket_id);

CREATE INDEX ticket_media_user_id_created_at_unattached_idx
  ON public.ticket_media (user_id, created_at)
  WHERE ticket_id IS NULL;

CREATE TABLE public.ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.service_tickets(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('created', 'status', 'reply', 'note', 'assigned', 'resolution')),
  from_status text,
  to_status text,
  body text,
  is_internal boolean NOT NULL DEFAULT false,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ticket_events_ticket_id_created_at_idx
  ON public.ticket_events (ticket_id, created_at);

CREATE TRIGGER update_ticket_issue_types_updated_at
  BEFORE UPDATE ON public.ticket_issue_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_service_tickets_updated_at
  BEFORE UPDATE ON public.service_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ticket_issue_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active ticket issue types"
  ON public.ticket_issue_types
  FOR SELECT
  TO anon, authenticated
  USING (is_active);

CREATE POLICY "Users can view own service tickets"
  ON public.service_tickets
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can view own ticket events"
  ON public.ticket_events
  FOR SELECT
  TO authenticated
  USING (
    is_internal = false
    AND EXISTS (
      SELECT 1
      FROM public.service_tickets
      WHERE service_tickets.id = ticket_events.ticket_id
        AND service_tickets.user_id = auth.uid()
    )
  );

COMMIT;

-- Expect tables = 4, rls_on = 4, policy_count = 3, issue_type_count = 6, sequence_exists = true.
SELECT
  (SELECT count(*)
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN ('ticket_issue_types', 'service_tickets', 'ticket_media', 'ticket_events')
  ) AS tables,
  (SELECT count(*)
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relrowsecurity
     AND c.relname IN ('ticket_issue_types', 'service_tickets', 'ticket_media', 'ticket_events')
  ) AS rls_on,
  (SELECT count(*)
   FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('ticket_issue_types', 'service_tickets', 'ticket_media', 'ticket_events')
  ) AS policy_count,
  (SELECT count(*) FROM public.ticket_issue_types) AS issue_type_count,
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND c.relname = 'service_ticket_no_seq'
  ) AS sequence_exists;
