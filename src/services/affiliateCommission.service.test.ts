import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateCommission,
  type CommissionEvalSettings,
  type CommissionItem,
} from './affiliateCommission.eval';

const LAPTOP = 'cat-laptops';
const CASE = 'cat-cases';

const flatAll = (overrides: Partial<CommissionEvalSettings> = {}): CommissionEvalSettings => ({
  eligibleScope: 'all',
  eligibleCategoryIds: new Set([LAPTOP]),
  commissionMode: 'flat',
  commissionPesewas: 20000,
  percentBp: 0,
  capPesewas: null,
  minOrderPesewas: 0,
  ...overrides,
});

function evalFor(items: CommissionItem[], settings: CommissionEvalSettings, discount = 0) {
  return evaluateCommission({ items, orderDiscountPesewas: discount, settings });
}

describe('affiliateCommission evaluateCommission', () => {
  it("all scope: a phone-case-only order earns the flat commission", () => {
    const result = evalFor(
      [{ categoryId: CASE, totalPricePesewas: 45_000 }],
      flatAll()
    );
    assert.equal(result.skipReason, null);
    assert.equal(result.amountPesewas, 20000);
  });

  it("categories scope: a non-matching item earns nothing with category_not_eligible", () => {
    const result = evalFor(
      [{ categoryId: CASE, totalPricePesewas: 45_000 }],
      flatAll({ eligibleScope: 'categories', eligibleCategoryIds: new Set([LAPTOP]) })
    );
    assert.equal(result.amountPesewas, 0);
    assert.equal(result.skipReason, 'category_not_eligible');
  });

  it("categories scope: an empty category list is a settings_error and pays nothing", () => {
    const result = evalFor(
      [{ categoryId: LAPTOP, totalPricePesewas: 150_000 }],
      flatAll({ eligibleScope: 'categories', eligibleCategoryIds: new Set() })
    );
    assert.equal(result.amountPesewas, 0);
    assert.equal(result.skipReason, 'settings_error');
  });

  it('below the minimum order: no commission, reason below_minimum', () => {
    const result = evalFor(
      [{ categoryId: LAPTOP, totalPricePesewas: 80_000 }],
      flatAll({ minOrderPesewas: 100_000 })
    );
    assert.equal(result.amountPesewas, 0);
    assert.equal(result.skipReason, 'below_minimum');
    assert.equal(result.eligibleSubtotalPesewas, 80_000);
  });

  it('percent mode without a cap: round(eligible x bp / 10000)', () => {
    const result = evalFor(
      [{ categoryId: CASE, totalPricePesewas: 100_000 }],
      flatAll({ commissionMode: 'percent', percentBp: 300 })
    );
    assert.equal(result.skipReason, null);
    assert.equal(result.amountPesewas, 3_000);
  });

  it('percent mode with a cap: the cap wins when the percent is higher', () => {
    const result = evalFor(
      [{ categoryId: LAPTOP, totalPricePesewas: 500_000 }],
      flatAll({
        commissionMode: 'percent',
        percentBp: 1000,
        capPesewas: 30_000,
      })
    );
    assert.equal(result.skipReason, null);
    assert.equal(result.amountPesewas, 30_000);
  });

  it('percent mode mixed-category order: only matching items count when scope is categories', () => {
    const items: CommissionItem[] = [
      { categoryId: LAPTOP, totalPricePesewas: 100_000 },
      { categoryId: CASE, totalPricePesewas: 20_000 },
    ];
    const result = evalFor(
      items,
      flatAll({
        eligibleScope: 'categories',
        eligibleCategoryIds: new Set([LAPTOP]),
        commissionMode: 'percent',
        percentBp: 1000,
      })
    );
    assert.equal(result.skipReason, null);
    assert.equal(result.eligibleSubtotalPesewas, 100_000);
    assert.equal(result.amountPesewas, 10_000);
  });
});
