BEGIN;

INSERT INTO public.settings (key, value, category, description) VALUES
  (
    'feature_affiliates_enabled',
    'false',
    'features',
    'When true, the paid affiliate programme is live'
  ),
  (
    'feature_vlb_v3_enabled',
    'false',
    'features',
    'When true, Laptop Banking V3.0 is live'
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;
