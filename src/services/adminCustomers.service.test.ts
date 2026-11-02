import './adminCustomers.testenv';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCustomer, listCustomers, type CustomerClient } from './adminCustomers.service';

const permissions = { affiliates: true, vlb: true };

const rpcRow = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'ann@ventech.test',
  first_name: 'Ann',
  last_name: 'Regular',
  full_name: 'Ann Regular',
  phone: '0201111111',
  created_at: '2026-02-01T12:00:00.000Z',
  newsletter_subscribed: false,
  is_affiliate: false,
  affiliate_id: null,
  affiliate_no: null,
  affiliate_status: null,
  affiliate_created_at: null,
  is_investor: false,
  investor_id: null,
  investor_no: null,
  investor_created_at: null,
  active_investments_count: 0,
  total_count: 1,
};

function missingRpc() {
  return {
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function public.admin_list_customers' },
  };
}

function createSelectBuilder(
  execute: (meta: { calls: string[]; range?: unknown; single?: boolean }) => unknown
) {
  const builder: {
    calls: string[];
    rangeArgs?: unknown;
    eq: (...args: unknown[]) => unknown;
    in: (...args: unknown[]) => unknown;
    not: (...args: unknown[]) => unknown;
    or: (...args: unknown[]) => unknown;
    gte: (...args: unknown[]) => unknown;
    lt: (...args: unknown[]) => unknown;
    ilike: (...args: unknown[]) => unknown;
    order: (...args: unknown[]) => unknown;
    range: (...args: unknown[]) => unknown;
    maybeSingle: () => Promise<unknown>;
    then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise<unknown>;
  } = {
    calls: [],
    eq() {
      builder.calls.push('eq');
      return builder;
    },
    in() {
      builder.calls.push('in');
      return builder;
    },
    not() {
      builder.calls.push('not');
      return builder;
    },
    or() {
      builder.calls.push('or');
      return builder;
    },
    gte() {
      builder.calls.push('gte');
      return builder;
    },
    lt() {
      builder.calls.push('lt');
      return builder;
    },
    ilike() {
      builder.calls.push('ilike');
      return builder;
    },
    order() {
      builder.calls.push('order');
      return builder;
    },
    range(...args: unknown[]) {
      builder.calls.push('range');
      builder.rangeArgs = args;
      return builder;
    },
    maybeSingle() {
      builder.calls.push('maybeSingle');
      return Promise.resolve(execute({ calls: builder.calls, range: builder.rangeArgs, single: true }));
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve(execute({ calls: builder.calls, range: builder.rangeArgs })).then(
        onFulfilled as (value: unknown) => unknown,
        onRejected
      );
    },
  };
  return builder;
}

function createStrictClient(options: {
  rpc?: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  onSelect?: (table: string, meta: { calls: string[]; range?: unknown; single?: boolean }) => unknown;
}): CustomerClient & { tables: string[]; selectCalls: Array<{ table: string; calls: string[]; range?: unknown }> } {
  const tables: string[] = [];
  const selectCalls: Array<{ table: string; calls: string[]; range?: unknown }> = [];
  return {
    tables,
    selectCalls,
    rpc: options.rpc || (async () => missingRpc()),
    from(table: string) {
      tables.push(table);
      return {
        select(_columns: string, _options?: { count?: string; head?: boolean }) {
          return createSelectBuilder((meta) => {
            selectCalls.push({ table, calls: [...meta.calls], range: meta.range });
            if (options.onSelect) return options.onSelect(table, meta);
            if (table === 'users' && meta.single) {
              return { data: { ...rpcRow, role: 'customer', affiliates: null, investors: null }, error: null };
            }
            if (table === 'users') {
              return { data: [{ ...rpcRow, role: 'customer', affiliates: null, investors: null }], error: null, count: 1 };
            }
            return { data: [], error: null, count: 0 };
          });
        },
      };
    },
  };
}

describe('supabase mock: filters only after select', () => {
  it('from() has select only; range/order/eq exist after select, not on the result of awaiting the builder', async () => {
    const db = createStrictClient({});
    const fromUsers = db.from('users') as { select: Function } & Record<string, unknown>;
    assert.equal(typeof fromUsers.select, 'function');
    assert.equal(fromUsers.range, undefined);
    assert.equal(fromUsers.order, undefined);
    assert.equal(fromUsers.eq, undefined);

    const builder = fromUsers.select('id') as { range: Function; order: Function; eq: Function };
    assert.equal(typeof builder.range, 'function');
    assert.equal(typeof builder.order, 'function');
    assert.equal(typeof builder.eq, 'function');

    const result = (await builder) as { range?: unknown };
    assert.equal(result.range, undefined);
    assert.throws(() => {
      (result as { range: Function }).range(0, 19);
    }, TypeError);
  });

  it('the staging bug (await builder, then .range) fails against this mock', async () => {
    const db = createStrictClient({});
    await assert.rejects(async () => {
      let query: any = await (db.from('users') as any).select('*').eq('role', 'customer');
      query = query.order('created_at', { ascending: false });
      await query.range(0, 19);
    }, /range is not a function|is not a function/);
  });
});

describe('listCustomers', () => {
  it('uses admin_list_customers when the RPC exists', async () => {
    const db = createStrictClient({
      rpc: async (fn) => {
        if (fn === 'admin_list_customers') return { data: [rpcRow], error: null };
        if (fn === 'admin_customer_type_counts') {
          return { data: [{ all_count: 1, regular_count: 1, affiliate_count: 0, investor_count: 0 }], error: null };
        }
        return missingRpc();
      },
    });
    const listed = await listCustomers(
      { page: 1, limit: 20, type: 'all', sort: 'newest', permissions },
      db
    );
    assert.equal(listed.total, 1);
    assert.equal(listed.rows.length, 1);
    assert.equal(listed.rows[0].email, 'ann@ventech.test');
    assert.equal(listed.counts.all, 1);
    assert.equal(listed.counts.regular, 1);
    assert.equal(db.tables.length, 0);
  });

  it('falls back to from().select().filters().order().range() and calls range on the builder', async () => {
    const db = createStrictClient({
      rpc: async () => missingRpc(),
    });
    const listed = await listCustomers(
      { page: 1, limit: 20, type: 'all', sort: 'newest', permissions },
      db
    );
    assert.equal(listed.rows.length, 1);
    const usersSelect = db.selectCalls.find((item) => item.table === 'users' && item.calls.includes('range'));
    assert.ok(usersSelect, 'users list must call range after select');
    assert.ok(usersSelect.calls.indexOf('eq') < usersSelect.calls.indexOf('range'));
    assert.ok(usersSelect.calls.indexOf('order') < usersSelect.calls.indexOf('range'));
    assert.deepEqual(usersSelect.range, [0, 19]);
  });
});

describe('getCustomer', () => {
  it('calls eq and maybeSingle on the builder returned by select', async () => {
    const db = createStrictClient({});
    const row = await getCustomer(rpcRow.id, permissions, db);
    assert.equal(row.email, 'ann@ventech.test');
    const call = db.selectCalls.find((item) => item.table === 'users' && item.calls.includes('maybeSingle'));
    assert.ok(call);
    assert.ok(call.calls.includes('eq'));
    assert.equal(call.calls[0], 'eq');
  });
});
