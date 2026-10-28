-- Indexes for Platform Extension list and job filters.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

CREATE INDEX IF NOT EXISTS vlb_investments_investor_id_created_at_idx
  ON public.vlb_investments (investor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vlb_investments_status_idx
  ON public.vlb_investments (status);

CREATE INDEX IF NOT EXISTS vlb_documents_investor_id_created_at_idx
  ON public.vlb_documents (investor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vlb_applications_status_created_at_idx
  ON public.vlb_applications (status, created_at DESC);

CREATE INDEX IF NOT EXISTS vlb_star_redemptions_investment_id_idx
  ON public.vlb_star_redemptions (investment_id);

CREATE INDEX IF NOT EXISTS affiliate_withdrawals_affiliate_id_status_idx
  ON public.affiliate_withdrawals (affiliate_id, status);

COMMIT;
