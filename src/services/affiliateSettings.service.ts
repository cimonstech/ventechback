import { supabaseAdmin } from '../utils/supabaseClient';
import { commissionCopy, type CommissionMode, type EligibleScope } from './affiliateCommission.eval';
import { settingsService } from './settings.service';

const DEFAULTS = {
  affiliate_fee_pesewas: 30000,
  affiliate_commission_pesewas: 20000,
  affiliate_activation_mode: 'approval',
  affiliate_fee_refund_on_rejection: true,
  affiliate_eligible_scope: 'all' as EligibleScope,
  affiliate_eligible_category_slugs: [] as string[],
  affiliate_commission_mode: 'flat' as CommissionMode,
  affiliate_commission_percent_bp: 0,
  affiliate_commission_cap_pesewas: null as number | null,
  affiliate_min_order_pesewas: 0,
  affiliate_attribution_days: 30,
  affiliate_return_window_days: 7,
  affiliate_withdrawal_min_pesewas: 20000,
  affiliate_payout_change_hold_hours: 48,
} as const;

export type AffiliateActivationMode = 'approval' | 'automatic';
export type { CommissionMode, EligibleScope };

export interface AffiliateSettings {
  feePesewas: number;
  commissionPesewas: number;
  activationMode: AffiliateActivationMode;
  refundFeeOnRejection: boolean;
  eligibleScope: EligibleScope;
  eligibleCategorySlugs: string[];
  commissionMode: CommissionMode;
  percentBp: number;
  capPesewas: number | null;
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

function asNullableInt(value: string | undefined): number | null {
  if (value === undefined || value === '' || value === 'null') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function asMode(value: string | undefined): AffiliateActivationMode {
  return value === 'automatic' ? 'automatic' : 'approval';
}

function asScope(value: string | undefined): EligibleScope {
  return value === 'categories' ? 'categories' : 'all';
}

function asCommissionMode(value: string | undefined): CommissionMode {
  return value === 'percent' ? 'percent' : 'flat';
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
      return cache || fromMap(new Map());
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
  const percentBp = asInt(map.get('affiliate_commission_percent_bp'), DEFAULTS.affiliate_commission_percent_bp);
  return {
    feePesewas: asInt(map.get('affiliate_fee_pesewas'), DEFAULTS.affiliate_fee_pesewas),
    commissionPesewas: asInt(map.get('affiliate_commission_pesewas'), DEFAULTS.affiliate_commission_pesewas),
    activationMode: asMode(map.get('affiliate_activation_mode')),
    refundFeeOnRejection: asBool(map.get('affiliate_fee_refund_on_rejection'), DEFAULTS.affiliate_fee_refund_on_rejection),
    eligibleScope: asScope(map.get('affiliate_eligible_scope')),
    eligibleCategorySlugs: asSlugs(map.get('affiliate_eligible_category_slugs'), DEFAULTS.affiliate_eligible_category_slugs),
    commissionMode: asCommissionMode(map.get('affiliate_commission_mode')),
    percentBp: Math.max(0, Math.min(5000, percentBp)),
    capPesewas: asNullableInt(map.get('affiliate_commission_cap_pesewas')),
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
  async eligibleScope(): Promise<EligibleScope> {
    return (await load()).eligibleScope;
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
      affiliate_eligible_scope: current.eligibleScope,
      affiliate_eligible_category_slugs: current.eligibleCategorySlugs,
      affiliate_commission_mode: current.commissionMode,
      affiliate_commission_percent_bp: current.percentBp,
      affiliate_commission_cap_pesewas: current.capPesewas,
      affiliate_min_order_pesewas: current.minOrderPesewas,
      affiliate_attribution_days: current.attributionDays,
      affiliate_return_window_days: current.returnWindowDays,
      affiliate_withdrawal_min_pesewas: current.withdrawalMinPesewas,
      affiliate_payout_change_hold_hours: current.payoutChangeHoldHours,
      commission_copy: commissionCopy({
        mode: current.commissionMode,
        commissionPesewas: current.commissionPesewas,
        percentBp: current.percentBp,
        capPesewas: current.capPesewas,
        minOrderPesewas: current.minOrderPesewas,
      }),
    };
  },
  async publicInfo() {
    const settings = await load();
    const slugs = settings.eligibleScope === 'categories' ? settings.eligibleCategorySlugs : [];
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
      commission_copy: commissionCopy({
        mode: settings.commissionMode,
        commissionPesewas: settings.commissionPesewas,
        percentBp: settings.percentBp,
        capPesewas: settings.capPesewas,
        minOrderPesewas: settings.minOrderPesewas,
      }),
      eligible_scope: settings.eligibleScope,
      eligible_category_names: names,
      commission_mode: settings.commissionMode,
      commission_percent_bp: settings.percentBp,
      commission_cap_pesewas: settings.capPesewas,
      min_order_pesewas: settings.minOrderPesewas,
      min_withdrawal_pesewas: settings.withdrawalMinPesewas,
      payout_methods: ['momo', 'bank'] as const,
      return_window_days: settings.returnWindowDays,
      payout_change_hold_hours: settings.payoutChangeHoldHours,
      fee_refund_on_rejection: settings.refundFeeOnRejection,
      payout_working_days: 3,
    };
  },
  async existingCategorySlugs(slugs: string[]): Promise<string[]> {
    const wanted = [...new Set(slugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean))];
    if (wanted.length === 0) return [];
    const { data, error } = await supabaseAdmin.from('categories').select('slug').in('slug', wanted);
    if (error) {
      console.error('affiliate category slugs', error);
      throw error;
    }
    return (data || []).map((row) => String(row.slug || '').toLowerCase()).filter(Boolean);
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
