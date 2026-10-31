import { formatPesewas } from '../utils/money';

export type SkipReason =
  | 'below_minimum'
  | 'category_not_eligible'
  | 'self_referral'
  | 'refunded'
  | 'settings_error';

export type EligibleScope = 'all' | 'categories';
export type CommissionMode = 'flat' | 'percent';

export interface CommissionItem {
  categoryId: string | null;
  totalPricePesewas: number;
}

export interface CommissionEvalSettings {
  eligibleScope: EligibleScope;
  /** Empty set means the category list is empty or matched nothing. */
  eligibleCategoryIds: Set<string>;
  commissionMode: CommissionMode;
  commissionPesewas: number;
  percentBp: number;
  capPesewas: number | null;
  minOrderPesewas: number;
}

export interface CommissionEvalResult {
  amountPesewas: number;
  skipReason: SkipReason | null;
  eligibleSubtotalPesewas: number;
}

export function ghsToPesewas(value: number | string | null | undefined): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function eligibleSubtotalPesewas(
  items: CommissionItem[],
  eligibleItems: CommissionItem[],
  orderDiscountPesewas: number
): number {
  const allRaw = items.reduce((sum, item) => sum + Math.max(0, item.totalPricePesewas), 0);
  const eligibleRaw = eligibleItems.reduce((sum, item) => sum + Math.max(0, item.totalPricePesewas), 0);
  if (eligibleRaw <= 0) return 0;
  const discountShare = allRaw > 0 ? Math.round(orderDiscountPesewas * eligibleRaw / allRaw) : 0;
  return Math.max(0, eligibleRaw - discountShare);
}

export function percentCommissionPesewas(
  eligibleSubtotal: number,
  percentBp: number,
  capPesewas: number | null
): number {
  let amount = Math.round((eligibleSubtotal * percentBp) / 10000);
  if (capPesewas != null && capPesewas > 0 && amount > capPesewas) {
    amount = capPesewas;
  }
  return Math.max(0, amount);
}

export function evaluateCommission(input: {
  selfReferral?: boolean;
  items: CommissionItem[];
  orderDiscountPesewas: number;
  settings: CommissionEvalSettings;
}): CommissionEvalResult {
  if (input.selfReferral) {
    return { amountPesewas: 0, skipReason: 'self_referral', eligibleSubtotalPesewas: 0 };
  }

  if (input.settings.eligibleScope === 'categories' && input.settings.eligibleCategoryIds.size === 0) {
    return { amountPesewas: 0, skipReason: 'settings_error', eligibleSubtotalPesewas: 0 };
  }

  const eligibleItems =
    input.settings.eligibleScope === 'all'
      ? input.items
      : input.items.filter(
          (item) => item.categoryId && input.settings.eligibleCategoryIds.has(item.categoryId)
        );

  if (eligibleItems.length === 0) {
    return { amountPesewas: 0, skipReason: 'category_not_eligible', eligibleSubtotalPesewas: 0 };
  }

  const eligibleSubtotalPesewasValue = eligibleSubtotalPesewas(
    input.items,
    eligibleItems,
    input.orderDiscountPesewas
  );

  if (eligibleSubtotalPesewasValue < input.settings.minOrderPesewas) {
    return {
      amountPesewas: 0,
      skipReason: 'below_minimum',
      eligibleSubtotalPesewas: eligibleSubtotalPesewasValue,
    };
  }

  if (input.settings.commissionMode === 'percent') {
    const amount = percentCommissionPesewas(
      eligibleSubtotalPesewasValue,
      input.settings.percentBp,
      input.settings.capPesewas
    );
    if (amount <= 0) {
      return {
        amountPesewas: 0,
        skipReason: 'settings_error',
        eligibleSubtotalPesewas: eligibleSubtotalPesewasValue,
      };
    }
    return {
      amountPesewas: amount,
      skipReason: null,
      eligibleSubtotalPesewas: eligibleSubtotalPesewasValue,
    };
  }

  if (input.settings.commissionPesewas <= 0) {
    return {
      amountPesewas: 0,
      skipReason: 'settings_error',
      eligibleSubtotalPesewas: eligibleSubtotalPesewasValue,
    };
  }

  return {
    amountPesewas: input.settings.commissionPesewas,
    skipReason: null,
    eligibleSubtotalPesewas: eligibleSubtotalPesewasValue,
  };
}

export function formatPercentFromBp(percentBp: number): string {
  const value = percentBp / 100;
  if (!Number.isFinite(value)) return '0%';
  const text = Number.isInteger(value) ? String(value) : String(value);
  return `${text}%`;
}

export function pesewasCopy(pesewas: number): string {
  return formatPesewas(pesewas);
}

export function commissionCopy(input: {
  mode: CommissionMode;
  commissionPesewas: number;
  percentBp: number;
  capPesewas: number | null;
  minOrderPesewas: number;
}): string {
  const min = pesewasCopy(input.minOrderPesewas);
  if (input.mode === 'percent') {
    const pct = formatPercentFromBp(input.percentBp);
    const cap =
      input.capPesewas != null && input.capPesewas > 0
        ? ` (up to ${pesewasCopy(input.capPesewas)})`
        : '';
    return `Earn ${pct} of every order${cap}. Minimum order ${min}.`;
  }
  return `Earn ${pesewasCopy(input.commissionPesewas)} on every order of ${min} or more`;
}

export function skipReasonCopy(reason: SkipReason | null | undefined, minOrderPesewas = 0): string {
  if (reason === 'below_minimum') {
    return `Below the ${pesewasCopy(minOrderPesewas)} minimum order`;
  }
  if (reason === 'category_not_eligible') return 'Product not included in the programme';
  if (reason === 'self_referral') return 'You cannot earn commission on your own order';
  if (reason === 'refunded') return 'Order refunded';
  if (reason === 'settings_error') return 'This sale could not be processed';
  return '';
}
