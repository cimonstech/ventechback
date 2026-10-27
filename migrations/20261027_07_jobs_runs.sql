-- Job run guard: one row per job and period, plus a transaction advisory lock
-- so two processes cannot claim the same run at once.
-- Do not run this file from the app. Apply it in the database SQL editor.

BEGIN;

CREATE TABLE IF NOT EXISTS public.jobs_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  period_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  counts jsonb,
  error text,
  UNIQUE (job_name, period_key)
);

ALTER TABLE public.jobs_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.jobs_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.jobs_runs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_job_run(
  p_job_name text,
  p_period_key text,
  p_stale_seconds int DEFAULT 1800
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing public.jobs_runs%ROWTYPE;
  stale_secs int;
BEGIN
  IF p_job_name IS NULL OR btrim(p_job_name) = '' OR p_period_key IS NULL OR btrim(p_period_key) = '' THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext(p_job_name), hashtext(p_period_key)) THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  stale_secs := GREATEST(COALESCE(p_stale_seconds, 1800), 60);

  SELECT * INTO existing
  FROM public.jobs_runs
  WHERE job_name = p_job_name
    AND period_key = p_period_key
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.jobs_runs (job_name, period_key, status)
    VALUES (p_job_name, p_period_key, 'running')
    RETURNING * INTO existing;
    RETURN jsonb_build_object('claimed', true, 'id', existing.id);
  END IF;

  IF existing.status = 'succeeded' THEN
    RETURN jsonb_build_object('claimed', false, 'id', existing.id);
  END IF;

  IF existing.status = 'running'
     AND existing.started_at > now() - make_interval(secs => stale_secs) THEN
    RETURN jsonb_build_object('claimed', false, 'id', existing.id);
  END IF;

  UPDATE public.jobs_runs
  SET status = 'running',
      started_at = now(),
      finished_at = NULL,
      counts = NULL,
      error = NULL
  WHERE id = existing.id
  RETURNING * INTO existing;

  RETURN jsonb_build_object('claimed', true, 'id', existing.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_job_run(
  p_id uuid,
  p_status text,
  p_counts jsonb DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status IS DISTINCT FROM 'succeeded' AND p_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'Invalid job status.';
  END IF;

  UPDATE public.jobs_runs
  SET status = p_status,
      finished_at = now(),
      counts = p_counts,
      error = CASE WHEN p_status = 'failed' THEN left(COALESCE(p_error, ''), 500) ELSE NULL END
  WHERE id = p_id
    AND status = 'running';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_job_run(text, text, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finish_job_run(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_job_run(text, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_job_run(uuid, text, jsonb, text) TO service_role;

COMMIT;

SELECT pg_get_functiondef('public.claim_job_run(text,text,int)'::regprocedure) IS NOT NULL AS claim_ok;
