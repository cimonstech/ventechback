import { supabaseAdmin } from '../utils/supabaseClient';
import { settingsService } from './settings.service';

const DEFAULTS = {
  affiliate_fee_pesewas: 30000,
  affiliate_commission_pesewas: 20000,
  affiliate_activation_mode: 'approval',
  affiliate_fee_refund_on_rejection: true,
  affiliate_eligible_category_slugs: ['laptops'],
  affiliate_min_order_pesewas: 0,
  affiliate_attribution_days: 30,
  affiliate_return_window_days: 7,
  affiliate_withdrawal_min_pesewas: 20000,
  affiliate_payout_change_hold_hours: 48,
} as const;

export type AffiliateActivationMode = 'approval' | 'automatic';

export interface AffiliateSettings {
  feePesewas: number;
  commissionPesewas: number;
  activationMode: AffiliateActivationMode;
  refundFeeOnRejection: boolean;
  eligibleCategorySlugs: string[];
  minOrderPesewas: number;
  attributionDays: number;
  returnWindowDays: number;
  withdrawalMinPesewas: number;
  payoutChangeHoldHours: number;
}

let cache: AffiliateSettings | null = null;
let cacheAt = 0;
const TTL_MS = 60 * 1000;

function asInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function asSlugs(value: string | undefined, fallback: readonly string[]): string[] {
  if (!value || !value.trim()) return [...fallback];
  return value.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
}

function asMode(value: string | undefined): AffiliateActivationMode {
  return value === 'automatic' ? 'automatic' : 'approval';
}

async function load(): Promise<AffiliateSettings> {
  const now = Date.now();
  if (cache && now - cacheAt < TTL_MS) return cache;
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('key, value')
      .eq('category', 'affiliate');
    if (error) {
      console.error('affiliate settings', error);
      return cache || { ...fromMap(new Map()) };
    }
    const map = new Map<string, string>();
    for (const row of data || []) {
      if (row.key && row.value !== null && row.value !== undefined) {
        map.set(row.key, String(row.value));
      }
    }
    cache = fromMap(map);
    cacheAt = now;
    return cache;
  } catch (error) {
    console.error('affiliate settings', error);
    return cache || fromMap(new Map());
  }
}

function fromMap(map: Map<string, string>): AffiliateSettings {
  return {
    feePesewas: asInt(map.get('affiliate_fee_pesewas'), DEFAULTS.affiliate_fee_pesewas),
    commissionPesewas: asInt(map.get('affiliate_commission_pesewas'), DEFAULTS.affiliate_commission_pesewas),
    activationMode: asMode(map.get('affiliate_activation_mode')),
    refundFeeOnRejection: asBool(map.get('affiliate_fee_refund_on_rejection'), DEFAULTS.affiliate_fee_refund_on_rejection),
    eligibleCategorySlugs: asSlugs(map.get('affiliate_eligible_category_slugs'), DEFAULTS.affiliate_eligible_category_slugs),
    minOrderPesewas: asInt(map.get('affiliate_min_order_pesewas'), DEFAULTS.affiliate_min_order_pesewas),
    attributionDays: asInt(map.get('affiliate_attribution_days'), DEFAULTS.affiliate_attribution_days),
    returnWindowDays: asInt(map.get('affiliate_return_window_days'), DEFAULTS.affiliate_return_window_days),
    withdrawalMinPesewas: asInt(map.get('affiliate_withdrawal_min_pesewas'), DEFAULTS.affiliate_withdrawal_min_pesewas),
    payoutChangeHoldHours: asInt(map.get('affiliate_payout_change_hold_hours'), DEFAULTS.affiliate_payout_change_hold_hours),
  };
}

export const affiliateSettings = {
  async get(): Promise<AffiliateSettings> {
    return load();
  },
  async feePesewas(): Promise<number> {
    return (await load()).feePesewas;
  },
  async commissionPesewas(): Promise<number> {
    return (await load()).commissionPesewas;
  },
  async activationMode(): Promise<AffiliateActivationMode> {
    return (await load()).activationMode;
  },
  async refundFeeOnRejection(): Promise<boolean> {
    return (await load()).refundFeeOnRejection;
  },
  async eligibleCategorySlugs(): Promise<string[]> {
    return (await load()).eligibleCategorySlugs;
  },
  async minOrderPesewas(): Promise<number> {
    return (await load()).minOrderPesewas;
  },
  async attributionDays(): Promise<number> {
    return (await load()).attributionDays;
  },
  async returnWindowDays(): Promise<number> {
    return (await load()).returnWindowDays;
  },
  async withdrawalMinPesewas(): Promise<number> {
    return (await load()).withdrawalMinPesewas;
  },
  async payoutChangeHoldHours(): Promise<number> {
    return (await load()).payoutChangeHoldHours;
  },
  clearCache() {
    cache = null;
    cacheAt = 0;
  },
  toPublic(settings?: AffiliateSettings) {
    const current = settings || cache || fromMap(new Map());
    return {
      affiliate_fee_pesewas: current.feePesewas,
      affiliate_commission_pesewas: current.commissionPesewas,
      affiliate_activation_mode: current.activationMode,
      affiliate_fee_refund_on_rejection: current.refundFeeOnRejection,
      affiliate_eligible_category_slugs: current.eligibleCategorySlugs,
      affiliate_min_order_pesewas: current.minOrderPesewas,
      affiliate_attribution_days: current.attributionDays,
      affiliate_return_window_days: current.returnWindowDays,
      affiliate_withdrawal_min_pesewas: current.withdrawalMinPesewas,
      affiliate_payout_change_hold_hours: current.payoutChangeHoldHours,
    };
  },
  async publicInfo() {
    const settings = await load();
    const slugs = settings.eligibleCategorySlugs;
    let names: string[] = [];
    if (slugs.length) {
      const { data, error } = await supabaseAdmin
        .from('categories')
        .select('name, slug')
        .in('slug', slugs);
      if (error) {
        console.error('affiliate public categories', error);
      }
      const bySlug = new Map(
        (data || []).map((row) => [String(row.slug), String(row.name || row.slug)])
      );
      names = slugs.map((slug) => bySlug.get(slug) || slug);
    }
    return {
      fee_pesewas: settings.feePesewas,
      commission_pesewas: settings.commissionPesewas,
      eligible_category_names: names,
      min_withdrawal_pesewas: settings.withdrawalMinPesewas,
      payout_methods: ['momo', 'bank'] as const,
    };
  },
  async save(values: Record<string, string>, userId: string): Promise<AffiliateSettings> {
    const keys = Object.keys(values);
    for (const key of keys) {
      const { error } = await supabaseAdmin
        .from('settings')
        .update({
          value: values[key],
          updated_at: new Date().toISOString(),
          updated_by: userId,
        })
        .eq('key', key)
        .eq('category', 'affiliate');
      if (error) {
        console.error('save affiliate setting', key, error);
        throw error;
      }
    }
    cache = null;
    cacheAt = 0;
    settingsService.clearCache();
    return load();
  },
};
