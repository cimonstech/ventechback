-- Signed Laptop Banking agreement files on an application, plus a 14-day
-- upload token. The blank agreement stays in vlb_documents (agreement_template).
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

CREATE TABLE public.vlb_application_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.vlb_applications(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('signed_agreement', 'other')),
  file_key text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes int NOT NULL CHECK (size_bytes > 0),
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_via text NOT NULL CHECK (uploaded_via IN ('application_form', 'upload_link', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_reason text,
  deleted_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX vlb_application_files_application_kind_idx
  ON public.vlb_application_files (application_id, kind);

ALTER TABLE public.vlb_application_files ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vlb_applications
  ADD COLUMN IF NOT EXISTS agreement_upload_token_hash text,
  ADD COLUMN IF NOT EXISTS agreement_upload_token_expires_at timestamptz;

COMMIT;
