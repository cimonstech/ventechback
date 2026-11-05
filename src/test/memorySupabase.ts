import { randomUUID } from 'crypto';
import { orderIsPreOrder, paymentReferenceUniqueKey } from '../services/orderPayment.logic';

type Row = Record<string, any>;

function uniqueError(constraint: string, details: string) {
  return {
    code: '23505',
    message: `duplicate key value violates unique constraint "${constraint}"`,
    details,
  };
}

function matches(row: Row, col: string, op: string, value: any): boolean {
  const current = row[col];
  if (op === 'eq') return current === value;
  if (op === 'in') return Array.isArray(value) && value.includes(current);
  if (op === 'gte') return current >= value;
  if (op === 'gt') return current > value;
  if (op === 'lte') return current <= value;
  if (op === 'lt') return current < value;
  if (op === 'neq') return current !== value;
  return true;
}

export function createMemorySupabase(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    products: [],
    delivery_options: [],
    orders: [],
    order_items: [],
    transactions: [],
    users: [],
    notifications: [],
    settings: [],
    affiliate_clicks: [],
    affiliates: [],
    affiliate_commissions: [],
    affiliate_ledger: [],
    categories: [],
    devices: [],
    coupons: [],
    ...Object.fromEntries(Object.entries(seed).map(([key, rows]) => [key, rows.map((row) => ({ ...row }))])),
  };

  const stats = {
    orderInserts: 0,
    stockDecrements: 0,
    transactionInserts: 0,
    commissionInserts: 0,
  };

  function paymentKey(row: Row): string | null {
    const ref = row.payment_reference || row.shipping_address?.payment_reference;
    if (!ref) return null;
    return paymentReferenceUniqueKey(String(ref), orderIsPreOrder(row));
  }

  async function insertRows(table: string, rows: Row[]): Promise<{ data: Row[] | null; error: any }> {
    await Promise.resolve();
    const inserted: Row[] = [];
    for (const incoming of rows) {
      const row: Row = {
        id: incoming.id || randomUUID(),
        created_at: incoming.created_at || new Date().toISOString(),
        ...incoming,
      };
      if (table === 'orders') {
        if (tables.orders.some((existing) => existing.order_number && existing.order_number === row.order_number)) {
          return { data: null, error: uniqueError('orders_order_number_key', `Key (order_number)=(${row.order_number}) already exists.`) };
        }
        const key = paymentKey(row);
        if (key && tables.orders.some((existing) => paymentKey(existing) === key)) {
          return {
            data: null,
            error: uniqueError(
              'orders_payment_reference_preorder_uidx',
              `Key (payment_reference)=(${row.payment_reference}) already exists.`
            ),
          };
        }
        stats.orderInserts += 1;
      }
      if (table === 'transactions') {
        if (
          row.transaction_reference &&
          tables.transactions.some((existing) => existing.transaction_reference === row.transaction_reference)
        ) {
          return {
            data: null,
            error: uniqueError(
              'transactions_transaction_reference_key',
              `Key (transaction_reference)=(${row.transaction_reference}) already exists.`
            ),
          };
        }
        if (
          row.paystack_reference &&
          tables.transactions.some((existing) => existing.paystack_reference === row.paystack_reference)
        ) {
          return {
            data: null,
            error: uniqueError(
              'transactions_paystack_reference_uidx',
              `Key (paystack_reference)=(${row.paystack_reference}) already exists.`
            ),
          };
        }
        stats.transactionInserts += 1;
      }
      if (table === 'affiliate_commissions') {
        if (
          row.order_id &&
          tables.affiliate_commissions.some((existing) => existing.order_id === row.order_id)
        ) {
          return { data: null, error: uniqueError('affiliate_commissions_order_id_key', 'duplicate order_id') };
        }
        if (
          row.checkout_reference &&
          tables.affiliate_commissions.some((existing) => existing.checkout_reference === row.checkout_reference)
        ) {
          return {
            data: null,
            error: uniqueError('affiliate_commissions_checkout_reference_key', 'duplicate checkout_reference'),
          };
        }
        stats.commissionInserts += 1;
      }
      tables[table] = tables[table] || [];
      tables[table].push(row);
      inserted.push(row);
    }
    return { data: inserted, error: null };
  }

  function applyFilters(table: string, filters: Array<[string, string, any]>, columns?: string) {
    let rows = (tables[table] || []).slice();
    for (const [op, col, value] of filters) {
      if (op === 'eq' || op === 'in' || op === 'gte' || op === 'gt' || op === 'lte' || op === 'lt' || op === 'neq') {
        rows = rows.filter((row) => matches(row, col, op, value));
      }
    }
    if (columns && columns !== '*' && !columns.includes('(')) {
      const wanted = columns.split(',').map((part) => part.trim()).filter(Boolean);
      rows = rows.map((row) => {
        const next: Row = {};
        for (const key of wanted) next[key] = row[key];
        if (row.id && !next.id) next.id = row.id;
        return { ...row, ...next };
      });
    }
    return rows;
  }

  function from(table: string) {
    const state: {
      filters: Array<[string, string, any]>;
      columns: string;
      orderCol?: string;
      ascending: boolean;
      limitN?: number;
      insertRows?: Row[];
      patch?: Row;
    } = { filters: [], columns: '*', ascending: false };

    const builder: any = {
      select(columns?: string) {
        state.columns = columns || '*';
        return builder;
      },
      eq(col: string, value: any) {
        state.filters.push(['eq', col, value]);
        return builder;
      },
      in(col: string, value: any) {
        state.filters.push(['in', col, value]);
        return builder;
      },
      gte(col: string, value: any) {
        state.filters.push(['gte', col, value]);
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        state.orderCol = col;
        state.ascending = !!opts?.ascending;
        return builder;
      },
      limit(n: number) {
        state.limitN = n;
        return builder;
      },
      or() {
        return builder;
      },
      not() {
        return builder;
      },
      is() {
        return builder;
      },
      ilike() {
        return builder;
      },
      range() {
        return builder;
      },
      insert(rows: Row | Row[]) {
        state.insertRows = Array.isArray(rows) ? rows : [rows];
        return builder;
      },
      update(patch: Row) {
        state.patch = patch;
        return builder;
      },
      maybeSingle: async () => {
        const { data, error } = await runSelect();
        if (error) return { data: null, error };
        return { data: (data && data[0]) || null, error: null };
      },
      single: async () => {
        const { data, error } = await runSelect();
        if (error) return { data: null, error };
        if (!data || !data[0]) return { data: null, error: { code: 'PGRST116', message: '0 rows' } };
        return { data: data[0], error: null };
      },
      then(onFulfilled: any, onRejected: any) {
        return runSelect().then(onFulfilled, onRejected);
      },
    };

    async function runSelect() {
      if (state.insertRows) {
        const inserted = await insertRows(table, state.insertRows);
        return inserted;
      }
      if (state.patch) {
        await Promise.resolve();
        const rows = applyFilters(table, state.filters);
        for (const row of rows) Object.assign(row, state.patch);
        return { data: rows, error: null };
      }
      await Promise.resolve();
      let rows = applyFilters(table, state.filters, state.columns);
      if (state.orderCol) {
        rows.sort((a, b) => {
          const av = a[state.orderCol as string];
          const bv = b[state.orderCol as string];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return state.ascending ? cmp : -cmp;
        });
      }
      if (state.limitN != null) rows = rows.slice(0, state.limitN);
      return { data: rows, error: null };
    }

    return builder;
  }

  async function rpc(name: string, args: Row) {
    await Promise.resolve();
    if (name === 'decrement_product_stock') {
      const product = (tables.products || []).find((row) => row.id === args.product_id_param);
      if (!product) return { data: null, error: { message: 'not found' } };
      if ((product.stock_quantity || 0) < args.quantity_param) {
        return { data: null, error: { message: 'insufficient stock' } };
      }
      product.stock_quantity -= args.quantity_param;
      product.in_stock = product.stock_quantity > 0;
      stats.stockDecrements += 1;
      return { data: product, error: null };
    }
    return { data: null, error: { code: 'PGRST202', message: `function ${name} not found` } };
  }

  return {
    from,
    rpc,
    tables,
    stats,
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  };
}
