import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PlanSnapshot,
  buildSchedule,
  renewalNudgeDue,
  termProgress,
  totals,
} from './vlbCalc.service';

const PRINCIPAL = 1_000_000;

const v30 = (overrides: Partial<PlanSnapshot> = {}): PlanSnapshot => ({
  terms_count: 3,
  months_per_term: 3,
  settlement_months: 1,
  term_rates_percent: [8, 8, 8],
  rate_basis: 'per_month',
  payout_frequency: 'monthly',
  scholar_fund_percent: 1,
  scholar_fund_basis: 'gross_payout',
  ...overrides,
});

describe('buildSchedule', () => {
  it('per_month + monthly: GHS 10,000 V3.0 worked example', () => {
    const schedule = buildSchedule(v30(), PRINCIPAL, '2026-01-15');
    const returns = schedule.filter((row) => row.type === 'return');
    const principal = schedule.find((row) => row.type === 'principal');

    assert.equal(returns.length, 9);
    assert.ok(principal);
    for (const row of returns) {
      assert.equal(row.gross_pesewas, 80_000);
      assert.equal(row.scholar_pesewas, 800);
      assert.equal(row.net_pesewas, 79_200);
    }
    assert.equal(principal.gross_pesewas, PRINCIPAL);
    assert.equal(principal.net_pesewas, PRINCIPAL);
    assert.equal(principal.scholar_pesewas, 0);
    assert.equal(principal.period_no, 10);
    assert.equal(principal.term_no, null);

    assert.equal(returns[0].term_no, 1);
    assert.equal(returns[2].term_no, 1);
    assert.equal(returns[3].term_no, 2);
    assert.equal(returns[8].term_no, 3);

    const t = totals(schedule);
    assert.equal(t.monthly_net, 79_200);
    assert.deepEqual(t.term_totals, [237_600, 237_600, 237_600]);
    assert.equal(t.total_net, 712_800);
    assert.equal(t.scholar_fund_total, 7_200);
    assert.equal(t.principal, PRINCIPAL);
  });

  it('per_month + end_of_term: one row per term at the last period', () => {
    const schedule = buildSchedule(
      v30({ payout_frequency: 'end_of_term' }),
      PRINCIPAL,
      '2026-01-15'
    );
    const returns = schedule.filter((row) => row.type === 'return');
    assert.equal(returns.length, 3);
    assert.deepEqual(returns.map((row) => row.period_no), [3, 6, 9]);
    for (const row of returns) {
      assert.equal(row.gross_pesewas, 240_000);
      assert.equal(row.scholar_pesewas, 2_400);
      assert.equal(row.net_pesewas, 237_600);
    }
    const principal = schedule.find((row) => row.type === 'principal');
    assert.equal(principal?.period_no, 10);
    assert.equal(principal?.gross_pesewas, PRINCIPAL);
  });

  it('per_term + monthly: rate spread evenly over the term months', () => {
    const schedule = buildSchedule(
      v30({ rate_basis: 'per_term' }),
      PRINCIPAL,
      '2026-01-15'
    );
    const returns = schedule.filter((row) => row.type === 'return');
    assert.equal(returns.length, 9);
    for (const row of returns) {
      assert.equal(row.gross_pesewas, 26_667);
      assert.equal(row.scholar_pesewas, 267);
      assert.equal(row.net_pesewas, 26_400);
    }
  });

  it('per_term + end_of_term: one row per term at the term rate', () => {
    const schedule = buildSchedule(
      v30({ rate_basis: 'per_term', payout_frequency: 'end_of_term' }),
      PRINCIPAL,
      '2026-01-15'
    );
    const returns = schedule.filter((row) => row.type === 'return');
    assert.equal(returns.length, 3);
    for (const row of returns) {
      assert.equal(row.gross_pesewas, 80_000);
      assert.equal(row.scholar_pesewas, 800);
      assert.equal(row.net_pesewas, 79_200);
    }
    assert.deepEqual(returns.map((row) => row.period_no), [3, 6, 9]);
  });

  it('clamps a 31 January start to month end', () => {
    const schedule = buildSchedule(v30(), PRINCIPAL, '2026-01-31');
    const due = schedule.map((row) => row.due_date);
    assert.equal(due[0], '2026-02-28');
    assert.equal(due[1], '2026-03-31');
    assert.equal(due[2], '2026-04-30');
    assert.equal(due[3], '2026-05-31');
    assert.equal(due[8], '2026-10-31');
    assert.equal(due[9], '2026-11-30');
  });

  it('rounds each payout line half up to the nearest pesewa', () => {
    const schedule = buildSchedule(
      v30({
        rate_basis: 'per_term',
        term_rates_percent: [8, 8, 8],
      }),
      PRINCIPAL,
      '2026-01-01'
    );
    // 1_000_000 * 8 / 100 / 3 = 26666.6... → 26667
    assert.equal(schedule[0].gross_pesewas, 26_667);

    const odd = buildSchedule(
      v30({ scholar_fund_percent: 1.5 }),
      50,
      '2026-01-01'
    );
    // gross = round(50 * 8 / 100) = 4; scholar = round(4 * 1.5 / 100) = round(0.06) = 0
    assert.equal(odd[0].gross_pesewas, 4);
    assert.equal(odd[0].scholar_pesewas, 0);

    const half = buildSchedule(
      v30({ scholar_fund_percent: 12.5 }),
      8,
      '2026-01-01'
    );
    // gross = round(8 * 8 / 100) = 1; scholar = round(1 * 12.5 / 100) = round(0.125) = 0
    assert.equal(half[0].gross_pesewas, 1);

    const halfUp = buildSchedule(
      {
        terms_count: 1,
        months_per_term: 1,
        settlement_months: 0,
        term_rates_percent: [0.05],
        rate_basis: 'per_month',
        payout_frequency: 'monthly',
        scholar_fund_percent: 0,
        scholar_fund_basis: 'gross_payout',
      },
      1_000,
      '2026-01-01'
    );
    // 1000 * 0.05 / 100 = 0.5 → 1
    assert.equal(halfUp[0].gross_pesewas, 1);
  });

  it('charges principal-basis scholar on the first payout of each term only', () => {
    const schedule = buildSchedule(
      v30({ scholar_fund_basis: 'principal' }),
      PRINCIPAL,
      '2026-01-01'
    );
    const returns = schedule.filter((row) => row.type === 'return');
    const firstOfTerm = [0, 3, 6];
    for (let i = 0; i < returns.length; i += 1) {
      if (firstOfTerm.includes(i)) {
        assert.equal(returns[i].scholar_pesewas, 10_000);
        assert.equal(returns[i].net_pesewas, 70_000);
      } else {
        assert.equal(returns[i].scholar_pesewas, 0);
        assert.equal(returns[i].net_pesewas, 80_000);
      }
      assert.equal(returns[i].gross_pesewas, 80_000);
    }
  });

  it('adds extra rate from the given period onward', () => {
    const schedule = buildSchedule(v30(), PRINCIPAL, '2026-01-01', { 4: 1 });
    const returns = schedule.filter((row) => row.type === 'return');
    assert.equal(returns[0].gross_pesewas, 80_000);
    assert.equal(returns[3].gross_pesewas, 90_000);
    assert.equal(returns[3].scholar_pesewas, 900);
    assert.equal(returns[8].gross_pesewas, 90_000);
  });
});

describe('renewalNudgeDue', () => {
  it('is true from today through 7 days before the final return month starts', () => {
    const progress = termProgress(v30(), '2026-01-15', '2026-09-15');
    assert.equal(progress.last_term_final_month_start, '2026-10-01');
    assert.equal(renewalNudgeDue('2026-09-24', '2026-10-01'), true);
    assert.equal(renewalNudgeDue('2026-10-01', '2026-10-01'), true);
    assert.equal(renewalNudgeDue('2026-09-23', '2026-10-01'), false);
    assert.equal(renewalNudgeDue('2026-10-02', '2026-10-01'), false);
  });
});
