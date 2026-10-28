import { AuthRequest } from '../middleware/auth.middleware';
import { supabaseAdmin } from '../utils/supabaseClient';
import { logAudit } from './audit.service';
import { settingsService } from './settings.service';

export const FEATURE_UNAVAILABLE = 'This feature is not available yet.';
export const FEATURE_AFFILIATES_KEY = 'feature_affiliates_enabled';
export const FEATURE_VLB_V3_KEY = 'feature_vlb_v3_enabled';

export interface FeatureFlags {
  feature_affiliates_enabled: boolean;
  feature_vlb_v3_enabled: boolean;
}

const TTL_MS = 60 * 1000;
const FLAG_KEYS = [FEATURE_AFFILIATES_KEY, FEATURE_VLB_V3_KEY] as const;

let cache: { at: number; flags: FeatureFlags } | null = null;

function asBool(value: string | null | undefined): boolean {
  return value === 'true';
}

export function clearFeatureFlagsCache() {
  cache = null;
}

export async function getFeatureFlags(): Promise<FeatureFlags> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return cache.flags;
  }

  const { data, error } = await supabaseAdmin
    .from('settings')
    .select('key, value')
    .in('key', [...FLAG_KEYS]);

  if (error) {
    console.error('feature flags', error);
    throw error;
  }

  const map = new Map((data || []).map((row) => [String(row.key), row.value as string | null]));
  const flags: FeatureFlags = {
    feature_affiliates_enabled: asBool(map.get(FEATURE_AFFILIATES_KEY)),
    feature_vlb_v3_enabled: asBool(map.get(FEATURE_VLB_V3_KEY)),
  };
  cache = { at: Date.now(), flags };
  return flags;
}

export async function isAffiliatesEnabled(): Promise<boolean> {
  return (await getFeatureFlags()).feature_affiliates_enabled;
}

export async function isVlbV3Enabled(): Promise<boolean> {
  return (await getFeatureFlags()).feature_vlb_v3_enabled;
}

export async function updateFeatureFlags(
  req: AuthRequest,
  patch: Partial<FeatureFlags>
): Promise<FeatureFlags> {
  const before = await getFeatureFlags();
  const userId = req.user?.id || null;

  for (const key of FLAG_KEYS) {
    const next = patch[key];
    if (next === undefined) continue;

    const { error } = await supabaseAdmin.from('settings').upsert(
      {
        key,
        value: next ? 'true' : 'false',
        category: 'features',
        description:
          key === FEATURE_AFFILIATES_KEY
            ? 'When true, the paid affiliate programme is live'
            : 'When true, Laptop Banking V3.0 is live',
        updated_at: new Date().toISOString(),
        updated_by: userId,
      },
      { onConflict: 'key' }
    );

    if (error) {
      console.error('update feature flag', key, error);
      throw new Error('Could not save feature flags.');
    }

    await logAudit({
      req,
      entity: 'settings',
      entityId: key,
      action: 'feature_flag_updated',
      before: { [key]: before[key] },
      after: { [key]: next },
    });
  }

  clearFeatureFlagsCache();
  settingsService.clearCache();
  return getFeatureFlags();
}
