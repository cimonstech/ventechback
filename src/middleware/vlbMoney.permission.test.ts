import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allowsVlbMoneyAction } from './vlbMoney.permission';

const both = [
  { module: 'vlb', can_view: true, can_edit: true },
  { module: 'finance', can_view: true, can_edit: true },
];
const vlbOnly = [
  { module: 'vlb', can_view: true, can_edit: true },
  { module: 'finance', can_view: true, can_edit: false },
];
const financeOnly = [
  { module: 'vlb', can_view: true, can_edit: false },
  { module: 'finance', can_view: true, can_edit: true },
];
const viewOnly = [
  { module: 'vlb', can_view: true, can_edit: false },
  { module: 'finance', can_view: true, can_edit: false },
];

describe('VLB money actions: activate, mark paid, settle, renew, referral bonus', () => {
  it('admins and superadmins can act even with no staff permission rows', () => {
    assert.equal(allowsVlbMoneyAction('admin', []), true);
    assert.equal(allowsVlbMoneyAction('superadmin', []), true);
  });

  it('staff need both Laptop Banking edit and Finance edit', () => {
    assert.equal(allowsVlbMoneyAction('staff', both), true);
    assert.equal(allowsVlbMoneyAction('staff', vlbOnly), false);
    assert.equal(allowsVlbMoneyAction('staff', financeOnly), false);
    assert.equal(allowsVlbMoneyAction('staff', viewOnly), false);
    assert.equal(allowsVlbMoneyAction('staff', []), false);
  });

  it('customers and other roles cannot', () => {
    assert.equal(allowsVlbMoneyAction('customer', both), false);
    assert.equal(allowsVlbMoneyAction('affiliate', both), false);
    assert.equal(allowsVlbMoneyAction(null, both), false);
  });
});
