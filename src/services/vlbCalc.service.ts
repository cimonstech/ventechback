export type RateBasis = 'per_month' | 'per_term';
export type PayoutFrequency = 'monthly' | 'end_of_term';
export type ScholarBasis = 'gross_payout' | 'principal';
export type PayoutType = 'return' | 'principal';

export interface PlanSnapshot {
  terms_count: number;
  months_per_term: number;
  settlement_months: number;
  term_rates_percent: number[];
  rate_basis: RateBasis;
  payout_frequency: PayoutFrequency;
  scholar_fund_percent: number;
  scholar_fund_basis: ScholarBasis;
}

export interface ScheduleRow {
  type: PayoutType;
  term_no: number | null;
  period_no: number;
  due_date: string;
  gross_pesewas: number;
  scholar_pesewas: number;
  net_pesewas: number;
}

export interface ScheduleTotals {
  monthly_net: number;
  term_totals: number[];
  total_net: number;
  scholar_fund_total: number;
  principal: number;
}

export type ExtraRateByPeriod = Record<number, number>;

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function addDays(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate)) throw new Error('Invalid date');
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new Error('Invalid date');
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

export function monthStart(isoDate: string): string {
  if (!isIsoDate(isoDate)) throw new Error('Invalid date');
  return `${isoDate.slice(0, 7)}-01`;
}

export function todayAccra(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addMonths(isoDate: string, months: number): string {
  if (!isIsoDate(isoDate)) {
    throw new Error('Invalid start date');
  }
  const [year, month, day] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, day));
  const expectedMonth = ((month - 1 + months) % 12 + 12) % 12;
  if (shifted.getUTCMonth() !== expectedMonth) {
    return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 0))
      .toISOString()
      .slice(0, 10);
  }
  return shifted.toISOString().slice(0, 10);
}

function roundPesewa(value: number): number {
  return Math.round(value);
}

function extraRateFrom(period: number, extraRateByPeriod?: ExtraRateByPeriod): number {
  if (!extraRateByPeriod) return 0;
  let extra = 0;
  for (const [fromRaw, rateRaw] of Object.entries(extraRateByPeriod)) {
    const from = Number(fromRaw);
    const rate = Number(rateRaw);
    if (Number.isFinite(from) && Number.isFinite(rate) && from <= period) {
      extra += rate;
    }
  }
  return extra;
}

function termRate(snapshot: PlanSnapshot, termNo: number): number {
  const rate = Number(snapshot.term_rates_percent[termNo - 1]);
  return Number.isFinite(rate) ? rate : 0;
}

function scholarOnGross(gross: number, percent: number): number {
  return roundPesewa(gross * percent / 100);
}

function scholarOnPrincipal(principal: number, percent: number): number {
  return roundPesewa(principal * percent / 100);
}

function returnRow(
  termNo: number,
  periodNo: number,
  dueDate: string,
  gross: number,
  scholar: number
): ScheduleRow {
  const scholarPesewas = Math.max(0, scholar);
  const grossPesewas = Math.max(0, gross);
  return {
    type: 'return',
    term_no: termNo,
    period_no: periodNo,
    due_date: dueDate,
    gross_pesewas: grossPesewas,
    scholar_pesewas: scholarPesewas,
    net_pesewas: Math.max(0, grossPesewas - scholarPesewas),
  };
}

export function snapshotFromPlan(plan: {
  terms_count: number | string;
  months_per_term: number | string;
  settlement_months: number | string;
  term_rates_percent: Array<number | string> | null;
  rate_basis: RateBasis;
  payout_frequency: PayoutFrequency;
  scholar_fund_percent: number | string;
  scholar_fund_basis: ScholarBasis;
}): PlanSnapshot {
  return {
    terms_count: Number(plan.terms_count),
    months_per_term: Number(plan.months_per_term),
    settlement_months: Number(plan.settlement_months),
    term_rates_percent: Array.isArray(plan.term_rates_percent)
      ? plan.term_rates_percent.map((rate) => Number(rate))
      : [],
    rate_basis: plan.rate_basis,
    payout_frequency: plan.payout_frequency,
    scholar_fund_percent: Number(plan.scholar_fund_percent),
    scholar_fund_basis: plan.scholar_fund_basis,
  };
}

export function planSnapshotFields(plan: {
  id: string;
  plan_group: string;
  tier: string;
  name: string;
  principal_pesewas: number;
  version: string;
  terms_count: number | string;
  months_per_term: number | string;
  settlement_months: number | string;
  term_rates_percent: Array<number | string> | null;
  rate_basis: RateBasis;
  payout_frequency: PayoutFrequency;
  scholar_fund_percent: number | string;
  scholar_fund_basis: ScholarBasis;
  premium_stars: number;
  referral_bonus_percent: number | string;
}): Record<string, unknown> {
  const snapshot = snapshotFromPlan(plan);
  return {
    id: plan.id,
    plan_group: plan.plan_group,
    tier: plan.tier,
    name: plan.name,
    principal_pesewas: Number(plan.principal_pesewas),
    version: plan.version,
    ...snapshot,
    premium_stars: Number(plan.premium_stars),
    referral_bonus_percent: Number(plan.referral_bonus_percent),
  };
}

export function buildSchedule(
  snapshot: PlanSnapshot,
  principalPesewas: number,
  startDate: string,
  extraRateByPeriod?: ExtraRateByPeriod
): ScheduleRow[] {
  const terms = Number(snapshot.terms_count);
  const monthsPerTerm = Number(snapshot.months_per_term);
  const settlementMonths = Number(snapshot.settlement_months);
  const scholarPercent = Number(snapshot.scholar_fund_percent);
  const principal = Number(principalPesewas);

  if (!Number.isInteger(terms) || terms < 1) {
    throw new Error('Invalid terms count');
  }
  if (!Number.isInteger(monthsPerTerm) || monthsPerTerm < 1) {
    throw new Error('Invalid months per term');
  }
  if (!Number.isInteger(settlementMonths) || settlementMonths < 0) {
    throw new Error('Invalid settlement months');
  }
  if (!Number.isInteger(principal) || principal <= 0) {
    throw new Error('Invalid principal');
  }
  if (!Number.isFinite(scholarPercent) || scholarPercent < 0) {
    throw new Error('Invalid scholar fund percent');
  }

  const returnPeriods = terms * monthsPerTerm;
  const scholarChargedForTerm = new Set<number>();
  const rows: ScheduleRow[] = [];

  const scholarFor = (termNo: number, gross: number): number => {
    if (snapshot.scholar_fund_basis === 'principal') {
      if (scholarChargedForTerm.has(termNo)) return 0;
      scholarChargedForTerm.add(termNo);
      return scholarOnPrincipal(principal, scholarPercent);
    }
    return scholarOnGross(gross, scholarPercent);
  };

  const periodRate = (period: number, termNo: number): number => {
    return termRate(snapshot, termNo) + extraRateFrom(period, extraRateByPeriod);
  };

  const emitMonthly = () => {
    for (let period = 1; period <= returnPeriods; period += 1) {
      const termNo = Math.ceil(period / monthsPerTerm);
      const rate = periodRate(period, termNo);
      const gross = snapshot.rate_basis === 'per_month'
        ? roundPesewa(principal * rate / 100)
        : roundPesewa(principal * rate / 100 / monthsPerTerm);
      rows.push(returnRow(
        termNo,
        period,
        addMonths(startDate, period),
        gross,
        scholarFor(termNo, gross)
      ));
    }
  };

  const emitEndOfTerm = () => {
    for (let termNo = 1; termNo <= terms; termNo += 1) {
      const period = termNo * monthsPerTerm;
      const rate = periodRate(period, termNo);
      const gross = snapshot.rate_basis === 'per_month'
        ? roundPesewa(principal * rate / 100 * monthsPerTerm)
        : roundPesewa(principal * rate / 100);
      rows.push(returnRow(
        termNo,
        period,
        addMonths(startDate, period),
        gross,
        scholarFor(termNo, gross)
      ));
    }
  };

  if (snapshot.payout_frequency === 'monthly') {
    emitMonthly();
  } else {
    emitEndOfTerm();
  }

  const principalPeriod = returnPeriods + settlementMonths;
  rows.push({
    type: 'principal',
    term_no: null,
    period_no: principalPeriod,
    due_date: addMonths(startDate, principalPeriod),
    gross_pesewas: principal,
    scholar_pesewas: 0,
    net_pesewas: principal,
  });

  return rows;
}

export function extraRateMap(
  bonuses: Array<{ applied_from_period: number; bonus_percent: number | string }>,
  extraRatePercent = 0
): ExtraRateByPeriod | undefined {
  const map: ExtraRateByPeriod = {};
  const base = Number(extraRatePercent);
  if (Number.isFinite(base) && base !== 0) map[1] = base;
  for (const bonus of bonuses) {
    const from = Number(bonus.applied_from_period);
    const rate = Number(bonus.bonus_percent);
    if (!Number.isFinite(from) || !Number.isFinite(rate) || rate === 0) continue;
    map[from] = (map[from] || 0) + rate;
  }
  return Object.keys(map).length ? map : undefined;
}

export function termProgress(
  snapshot: PlanSnapshot,
  startDate: string,
  today: string
): {
  current_term: number;
  days_elapsed: number;
  days_total: number;
  last_return_due: string;
  last_term_final_month_start: string;
  settlement_month_start: string;
  renewal_open: boolean;
} {
  const terms = Number(snapshot.terms_count);
  const months = Number(snapshot.months_per_term);
  const returnPeriods = terms * months;
  const lastReturnDue = addMonths(startDate, returnPeriods);
  const lastTermFinalMonthStart = monthStart(lastReturnDue);
  const settlementMonthStart = addMonths(lastTermFinalMonthStart, 1);
  const renewalOpen = today >= lastTermFinalMonthStart && today < settlementMonthStart;

  let currentTerm = terms;
  for (let term = 1; term <= terms; term += 1) {
    const termEnd = addMonths(startDate, term * months);
    if (today < termEnd) {
      currentTerm = term;
      break;
    }
  }

  const termStart = currentTerm === 1 ? startDate : addMonths(startDate, (currentTerm - 1) * months);
  const termEnd = addMonths(startDate, currentTerm * months);
  const daysTotal = Math.max(1, daysBetween(termStart, termEnd));
  const daysElapsed = Math.min(daysTotal, Math.max(0, daysBetween(termStart, today)));

  return {
    current_term: currentTerm,
    days_elapsed: daysElapsed,
    days_total: daysTotal,
    last_return_due: lastReturnDue,
    last_term_final_month_start: lastTermFinalMonthStart,
    settlement_month_start: settlementMonthStart,
    renewal_open: renewalOpen,
  };
}

export function renewalNudgeDue(today: string, lastTermFinalMonthStart: string): boolean {
  if (!isIsoDate(today) || !isIsoDate(lastTermFinalMonthStart)) return false;
  return lastTermFinalMonthStart >= today && lastTermFinalMonthStart <= addDays(today, 7);
}

export function totals(schedule: ScheduleRow[]): ScheduleTotals {
  const returns = schedule.filter((row) => row.type === 'return');
  const principalRow = schedule.find((row) => row.type === 'principal');
  const termTotals: number[] = [];
  for (const row of returns) {
    if (row.term_no == null) continue;
    termTotals[row.term_no - 1] = (termTotals[row.term_no - 1] || 0) + row.net_pesewas;
  }
  return {
    monthly_net: returns[0]?.net_pesewas ?? 0,
    term_totals: termTotals,
    total_net: returns.reduce((sum, row) => sum + row.net_pesewas, 0),
    scholar_fund_total: returns.reduce((sum, row) => sum + row.scholar_pesewas, 0),
    principal: principalRow?.gross_pesewas ?? 0,
  };
}
