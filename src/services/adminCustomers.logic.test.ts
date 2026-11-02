import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  csvTypeLabel,
  isListedCustomerRole,
  presentCustomerRow,
  queryCustomers,
  resolveTypeFilter,
  type AffiliateLink,
  type CustomerUser,
  type InvestmentLink,
  type InvestorLink,
} from './adminCustomers.logic';

const day = (value: string) => `${value}T12:00:00.000Z`;

const users: CustomerUser[] = [
  { id: 'staff-1', role: 'staff', email: 'staff@ventech.test', first_name: 'Sam', last_name: 'Staff', phone: '0200000001', created_at: day('2026-01-01') },
  { id: 'admin-1', role: 'admin', email: 'admin@ventech.test', first_name: 'Ada', last_name: 'Admin', phone: '0200000002', created_at: day('2026-01-01') },
  { id: 'super-1', role: 'superadmin', email: 'super@ventech.test', first_name: 'Sue', last_name: 'Super', phone: '0200000003', created_at: day('2026-01-01') },
  { id: 'a', role: 'customer', email: 'a@ventech.test', first_name: 'Ann', last_name: 'Regular', phone: '0201111111', created_at: day('2026-02-01') },
  { id: 'b', role: 'customer', email: 'b@ventech.test', first_name: 'Ben', last_name: 'Affiliate', phone: '0202222222', created_at: day('2026-03-01') },
  { id: 'c', role: 'customer', email: 'c@ventech.test', first_name: 'Cara', last_name: 'Investor', phone: '0203333333', created_at: day('2026-04-01') },
  { id: 'd', role: 'customer', email: 'd@ventech.test', first_name: 'Drew', last_name: 'Both', phone: '0204444444', created_at: day('2026-05-01') },
  { id: 'e', role: 'customer', email: 'e@ventech.test', first_name: 'Eve', last_name: 'Empty', phone: '0205555555', created_at: day('2026-06-01') },
];

const affiliates: AffiliateLink[] = [
  { id: 'aff-b', user_id: 'b', affiliate_no: 'VT-AFF-00012', status: 'pending', created_at: day('2026-03-02') },
  { id: 'aff-d', user_id: 'd', affiliate_no: 'VT-AFF-00013', status: 'active', created_at: day('2026-05-02') },
];

const investors: InvestorLink[] = [
  { id: 'inv-c', user_id: 'c', investor_no: 'VT-VLB-00003', created_at: day('2026-04-02') },
  { id: 'inv-d', user_id: 'd', investor_no: 'VT-VLB-00004', created_at: day('2026-05-03') },
  { id: 'inv-e', user_id: 'e', investor_no: 'VT-VLB-00005', created_at: day('2026-06-02') },
];

const investments: InvestmentLink[] = [
  { investor_id: 'inv-c', status: 'active' },
  { investor_id: 'inv-d', status: 'settled' },
];

const full = { affiliates: true, vlb: true };

describe('customers list never includes staff accounts', () => {
  it('only role=customer is listed', () => {
    assert.equal(isListedCustomerRole('customer'), true);
    assert.equal(isListedCustomerRole('staff'), false);
    assert.equal(isListedCustomerRole('admin'), false);
    assert.equal(isListedCustomerRole('superadmin'), false);
    const { rows, counts } = queryCustomers(users, affiliates, investors, investments, { type: 'all' }, full);
    assert.equal(counts.all, 5);
    assert.deepEqual(rows.map((row) => row.id).sort(), ['a', 'b', 'c', 'd', 'e']);
    assert.equal(rows.some((row) => row.id === 'staff-1' || row.id === 'admin-1' || row.id === 'super-1'), false);
  });
});

describe('type filters with correct totals', () => {
  it('splits regular, affiliate, investor, and all', () => {
    const { counts } = queryCustomers(users, affiliates, investors, investments, { type: 'all' }, full);
    assert.deepEqual(counts, { all: 5, regular: 1, affiliate: 2, investor: 3 });
  });

  it('regular is customers with no affiliate and no investor record', () => {
    const { rows } = queryCustomers(users, affiliates, investors, investments, { type: 'regular' }, full);
    assert.deepEqual(rows.map((row) => row.id), ['a']);
  });

  it('affiliate includes any status and can filter pending', () => {
    const allAff = queryCustomers(users, affiliates, investors, investments, { type: 'affiliate' }, full);
    assert.deepEqual(allAff.rows.map((row) => row.id).sort(), ['b', 'd']);
    const pending = queryCustomers(
      users,
      affiliates,
      investors,
      investments,
      { type: 'affiliate', affiliateStatus: 'pending' },
      full
    );
    assert.deepEqual(pending.rows.map((row) => row.id), ['b']);
    assert.equal(pending.counts.affiliate, 2);
  });

  it('investor active vs past', () => {
    const active = queryCustomers(
      users,
      affiliates,
      investors,
      investments,
      { type: 'investor', investorStatus: 'active' },
      full
    );
    assert.deepEqual(active.rows.map((row) => row.id), ['c']);
    const past = queryCustomers(
      users,
      affiliates,
      investors,
      investments,
      { type: 'investor', investorStatus: 'past' },
      full
    );
    assert.deepEqual(past.rows.map((row) => row.id), ['d']);
    const allInv = queryCustomers(users, affiliates, investors, investments, { type: 'investor' }, full);
    assert.deepEqual(allInv.rows.map((row) => row.id).sort(), ['c', 'd', 'e']);
  });

  it('search does not change the type meaning of the counts', () => {
    const { rows, counts } = queryCustomers(
      users,
      affiliates,
      investors,
      investments,
      { type: 'all', search: 'Drew' },
      full
    );
    assert.deepEqual(rows.map((row) => row.id), ['d']);
    assert.deepEqual(counts, { all: 1, regular: 0, affiliate: 1, investor: 1 });
  });
});

describe('a user who is both affiliate and investor', () => {
  it('appears in both type lists and keeps both fields', () => {
    const both = queryCustomers(users, affiliates, investors, investments, { type: 'all' }, full).rows.find(
      (row) => row.id === 'd'
    );
    assert.ok(both);
    assert.equal(both.is_affiliate, true);
    assert.equal(both.affiliate_no, 'VT-AFF-00013');
    assert.equal(both.affiliate_status, 'active');
    assert.equal(both.is_investor, true);
    assert.equal(both.investor_no, 'VT-VLB-00004');
    assert.equal(both.active_investments_count, 0);
    assert.equal(csvTypeLabel(both), 'Affiliate; Investor');
    const asAffiliate = queryCustomers(users, affiliates, investors, investments, { type: 'affiliate' }, full);
    const asInvestor = queryCustomers(users, affiliates, investors, investments, { type: 'investor' }, full);
    assert.ok(asAffiliate.rows.some((row) => row.id === 'd'));
    assert.ok(asInvestor.rows.some((row) => row.id === 'd'));
  });
});

describe('staff without vlb view', () => {
  it('strips investor fields and ignores the investor type', () => {
    const permissions = { affiliates: true, vlb: false };
    assert.equal(resolveTypeFilter('investor', permissions), 'all');
    const { rows, counts } = queryCustomers(users, affiliates, investors, investments, { type: 'investor' }, permissions);
    assert.equal(counts.investor, null);
    assert.equal(counts.affiliate, 2);
    assert.equal(rows.length, 5);
    const cara = rows.find((row) => row.id === 'c');
    assert.ok(cara);
    assert.equal(cara.is_investor, null);
    assert.equal(cara.investor_no, null);
    assert.equal(cara.active_investments_count, null);
    assert.equal(cara.is_affiliate, false);
  });

  it('presentCustomerRow nulls investor data when vlb is off', () => {
    const user = users.find((row) => row.id === 'c')!;
    const row = presentCustomerRow(
      user,
      null,
      investors.find((row) => row.user_id === 'c')!,
      [{ status: 'active' }],
      { affiliates: false, vlb: false }
    );
    assert.equal(row.is_affiliate, null);
    assert.equal(row.affiliate_no, null);
    assert.equal(row.is_investor, null);
    assert.equal(row.investor_no, null);
    assert.equal(row.active_investments_count, null);
  });
});
