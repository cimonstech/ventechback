BEGIN;
DROP FUNCTION IF EXISTS public.finish_job_run(uuid, text, jsonb, text);
DROP FUNCTION IF EXISTS public.claim_job_run(text, text, int);
DROP TABLE IF EXISTS public.jobs_runs;
COMMIT;
