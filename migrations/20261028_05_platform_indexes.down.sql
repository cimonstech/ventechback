BEGIN;

DROP INDEX IF EXISTS public.vlb_investments_investor_id_created_at_idx;
DROP INDEX IF EXISTS public.vlb_investments_status_idx;
DROP INDEX IF EXISTS public.vlb_documents_investor_id_created_at_idx;
DROP INDEX IF EXISTS public.vlb_applications_status_created_at_idx;
DROP INDEX IF EXISTS public.vlb_star_redemptions_investment_id_idx;
DROP INDEX IF EXISTS public.affiliate_withdrawals_affiliate_id_status_idx;

COMMIT;
