-- Rolls back 20261027_08_laptop_banking.sql.
-- Drops VLB tables in reverse order, then next_investor_no and investor_no_seq.

BEGIN;

DROP TABLE public.vlb_upgrade_requests;
DROP TABLE public.vlb_referral_bonuses;
DROP TABLE public.vlb_star_redemptions;
DROP TABLE public.vlb_documents;
DROP TABLE public.vlb_payouts;
DROP TABLE public.vlb_investments;
DROP TABLE public.investors;
DROP TABLE public.vlb_applications;
DROP TABLE public.vlb_plans;

DROP FUNCTION IF EXISTS public.next_investor_no();
DROP SEQUENCE public.investor_no_seq;

COMMIT;
