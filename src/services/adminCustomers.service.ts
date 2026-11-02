import { supabaseAdmin } from '../utils/supabaseClient';
import {
  AFFILIATE_STATUSES,
  CustomerPermissions,
  INVESTOR_STATUSES,
  LIVE_INVESTMENT_STATUSES,
  csvTypeLabel,
  isListedCustomerRole,
  parseAffiliateStatus,
  parseCustomerType,
  parseInvestorStatus,
  presentCustomerDetail,
  presentCustomerRow,
  resolveTypeFilter,
  type AffiliateLink,
  type AffiliateStatus,
  type CustomerUser,
  type InvestorLink,
  type InvestorStatus,
} from './adminCustomers.logic';

export class CustomerError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'customer_error'
  ) {
    super(message);
  }
}

export type CustomerClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (table: string) => { select: (columns: string, options?: { count?: string; head?: boolean }) => unknown };
};

type ListInput = {
  page: number;
  limit: number;
  type?: string;
  affiliateStatus?: string;
  investorStatus?: string;
  search?: string;
  from?: string;
  to?: string;
  sort?: string;
  permissions: CustomerPermissions;
};

type EmbeddedUser = CustomerUser & {
  affiliates?: AffiliateLink[] | AffiliateLink | null;
  investors?: InvestorLink[] | InvestorLink | null;
};

type RpcCustomer = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  newsletter_subscribed: boolean | null;
  is_affiliate: boolean;
  affiliate_id: string | null;
  affiliate_no: string | null;
  affiliate_status: string | null;
  affiliate_created_at: string | null;
  is_investor: boolean;
  investor_id: string | null;
  investor_no: string | null;
  investor_created_at: string | null;
  active_investments_count: number | null;
  total_count: number | string | null;
};

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function logDb(scope: string, error: unknown) {
  console.error(`customers ${scope}`, error);
}

function searchTerm(raw: string): string {
  return raw.replace(/[%_\\",()]/g, '').trim().slice(0, 80);
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function inFilter(ids: string[]): string[] {
  return ids.length ? ids : ['00000000-0000-0000-0000-000000000000'];
}

function emptyCounts(permissions: CustomerPermissions) {
  return {
    all: 0,
    regular: 0,
    affiliate: permissions.affiliates ? 0 : null,
    investor: permissions.vlb ? 0 : null,
  };
}

function isMissingRpc(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const row = error as { code?: string; message?: string };
  const code = String(row.code || '');
  const message = String(row.message || '');
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    /could not find the function/i.test(message) ||
    /function .* does not exist/i.test(message)
  );
}

function dateFrom(from?: string): string | null {
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) return `${from}T00:00:00.000Z`;
  return null;
}

function dateToExclusive(to?: string): string | null {
  if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const end = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) return null;
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString();
}

function applyDates(query: any, from?: string, to?: string) {
  let next = query;
  const start = dateFrom(from);
  const end = dateToExclusive(to);
  if (start) next = next.gte('created_at', start);
  if (end) next = next.lt('created_at', end);
  return next;
}

function parseListInput(input: ListInput) {
  if (input.type && parseCustomerType(input.type) === null) {
    throw new CustomerError(400, 'That type is not available.');
  }
  if (input.affiliateStatus && !parseAffiliateStatus(input.affiliateStatus)) {
    throw new CustomerError(400, 'That affiliate status is not available.');
  }
  if (input.investorStatus && !parseInvestorStatus(input.investorStatus)) {
    throw new CustomerError(400, 'That investor status is not available.');
  }
  const type = resolveTypeFilter(input.type, input.permissions);
  const affiliateStatus =
    type === 'affiliate' ? parseAffiliateStatus(input.affiliateStatus) : null;
  const investorStatus = type === 'investor' ? parseInvestorStatus(input.investorStatus) : null;
  const sortAsc = input.sort === 'oldest';
  return { type, affiliateStatus, investorStatus, sortAsc };
}

function customerSelect() {
  return [
    'id, email, first_name, last_name, full_name, phone, role, created_at, newsletter_subscribed',
    'affiliates!affiliates_user_id_fkey(id, user_id, affiliate_no, status, created_at)',
    'investors!investors_user_id_fkey(id, user_id, investor_no, created_at)',
  ].join(', ');
}

function asRows<T>(data: unknown): T[] {
  if (!data) return [];
  return Array.isArray(data) ? (data as T[]) : [data as T];
}

function presentRpcRow(row: RpcCustomer, permissions: CustomerPermissions) {
  const affiliate = row.is_affiliate && row.affiliate_id
    ? {
        id: row.affiliate_id,
        user_id: row.id,
        affiliate_no: row.affiliate_no,
        status: row.affiliate_status || '',
        created_at: row.affiliate_created_at || row.created_at,
      }
    : null;
  const investor = row.is_investor && row.investor_id
    ? {
        id: row.investor_id,
        user_id: row.id,
        investor_no: row.investor_no,
        created_at: row.investor_created_at || row.created_at,
      }
    : null;
  const live = Math.max(0, Number(row.active_investments_count) || 0);
  return presentCustomerRow(
    {
      id: row.id,
      role: 'customer',
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      full_name: row.full_name,
      phone: row.phone,
      created_at: row.created_at,
      newsletter_subscribed: row.newsletter_subscribed,
    },
    affiliate,
    investor,
    Array.from({ length: live }, () => ({ status: 'active' })),
    permissions
  );
}

function mapTypeCounts(data: unknown, permissions: CustomerPermissions) {
  const row = asRows<{
    all_count?: number | string | null;
    regular_count?: number | string | null;
    affiliate_count?: number | string | null;
    investor_count?: number | string | null;
  }>(data)[0];
  if (!row) return emptyCounts(permissions);
  return {
    all: Number(row.all_count) || 0,
    regular: Number(row.regular_count) || 0,
    affiliate: permissions.affiliates ? Number(row.affiliate_count) || 0 : null,
    investor: permissions.vlb ? Number(row.investor_count) || 0 : null,
  };
}

async function searchUserIds(db: CustomerClient, term: string): Promise<string[] | null> {
  if (!term) return null;
  const [users, aff, inv] = await Promise.all([
    (db.from('users') as any)
      .select('id')
      .eq('role', 'customer')
      .or(
        [
          `email.ilike.%${term}%`,
          `full_name.ilike.%${term}%`,
          `first_name.ilike.%${term}%`,
          `last_name.ilike.%${term}%`,
          `phone.ilike.%${term}%`,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term) ? `id.eq.${term}` : '',
        ]
          .filter(Boolean)
          .join(',')
      ),
    (db.from('affiliates') as any).select('user_id').ilike('affiliate_no', `%${term}%`),
    (db.from('investors') as any).select('user_id').ilike('investor_no', `%${term}%`),
  ]);
  if (users.error) {
    logDb('search users', users.error);
    throw new CustomerError(500, 'Could not load customers.');
  }
  if (aff.error) logDb('search affiliate numbers', aff.error);
  if (inv.error) logDb('search investor numbers', inv.error);
  const ids = new Set<string>();
  for (const row of users.data || []) ids.add(row.id);
  for (const row of aff.data || []) if (row.user_id) ids.add(row.user_id);
  for (const row of inv.data || []) if (row.user_id) ids.add(row.user_id);
  return [...ids];
}

async function affiliateUserIds(db: CustomerClient, status?: AffiliateStatus | null): Promise<string[]> {
  let query = (db.from('affiliates') as any).select('user_id');
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) {
    logDb('affiliate ids', error);
    throw new CustomerError(500, 'Could not load customers.');
  }
  return (data || []).map((row: { user_id: string }) => row.user_id).filter(Boolean);
}

async function investorUserIds(db: CustomerClient, status?: InvestorStatus | null): Promise<string[]> {
  const { data: investors, error } = await (db.from('investors') as any).select('id, user_id');
  if (error) {
    logDb('investor ids', error);
    throw new CustomerError(500, 'Could not load customers.');
  }
  const rows = investors || [];
  if (!status) return rows.map((row: { user_id: string }) => row.user_id).filter(Boolean);

  const { data: live, error: liveError } = await (db.from('vlb_investments') as any)
    .select('investor_id')
    .in('status', [...LIVE_INVESTMENT_STATUSES]);
  if (liveError) {
    logDb('live investments', liveError);
    throw new CustomerError(500, 'Could not load customers.');
  }
  const liveIds = new Set((live || []).map((row: { investor_id: string }) => row.investor_id));

  if (status === 'active') {
    return rows.filter((row: { id: string }) => liveIds.has(row.id)).map((row: { user_id: string }) => row.user_id);
  }

  const { data: anyInv, error: anyError } = await (db.from('vlb_investments') as any).select('investor_id');
  if (anyError) {
    logDb('any investments', anyError);
    throw new CustomerError(500, 'Could not load customers.');
  }
  const hasInvestment = new Set((anyInv || []).map((row: { investor_id: string }) => row.investor_id));
  return rows
    .filter((row: { id: string }) => hasInvestment.has(row.id) && !liveIds.has(row.id))
    .map((row: { user_id: string }) => row.user_id);
}

async function loadActiveCounts(db: CustomerClient, investorIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!investorIds.length) return counts;
  const { data, error } = await (db.from('vlb_investments') as any)
    .select('investor_id, status')
    .in('investor_id', investorIds)
    .in('status', [...LIVE_INVESTMENT_STATUSES]);
  if (error) {
    logDb('active investments', error);
    throw new CustomerError(500, 'Could not load customers.');
  }
  for (const row of data || []) {
    counts.set(row.investor_id, (counts.get(row.investor_id) || 0) + 1);
  }
  return counts;
}

async function presentRows(db: CustomerClient, rows: EmbeddedUser[], permissions: CustomerPermissions) {
  const investorIds = rows
    .map((row) => first(row.investors)?.id)
    .filter((id): id is string => Boolean(id));
  const live = permissions.vlb ? await loadActiveCounts(db, investorIds) : new Map<string, number>();
  return rows.map((row) => {
    const investor = first(row.investors);
    const investments = investor
      ? Array.from({ length: live.get(investor.id) || 0 }, () => ({ status: 'active' }))
      : [];
    return presentCustomerRow(row, row.affiliates, row.investors, investments, permissions);
  });
}

async function countHead(
  db: CustomerClient,
  extra: (query: any) => any,
  termIds: string[] | null,
  from?: string,
  to?: string
): Promise<number> {
  let query = (db.from('users') as any).select('id', { count: 'exact', head: true }).eq('role', 'customer');
  query = applyDates(query, from, to);
  if (termIds) query = query.in('id', inFilter(termIds));
  query = extra(query);
  const { count, error } = await query;
  if (error) {
    logDb('count', error);
    throw new CustomerError(500, 'Could not load customers.');
  }
  return count || 0;
}

async function customerTypeCountsBuilder(
  db: CustomerClient,
  input: { search?: string; from?: string; to?: string; permissions: CustomerPermissions }
) {
  const term = searchTerm(input.search || '');
  const termIds = await searchUserIds(db, term);
  if (termIds && termIds.length === 0) return emptyCounts(input.permissions);

  const exclude = await Promise.all([affiliateUserIds(db), investorUserIds(db)]).then((parts) => [
    ...new Set(parts.flat()),
  ]);
  const affiliateIds = input.permissions.affiliates ? await affiliateUserIds(db) : [];
  const investorIds = input.permissions.vlb ? await investorUserIds(db) : [];

  const [all, regular, affiliate, investor] = await Promise.all([
    countHead(db, (query) => query, termIds, input.from, input.to),
    countHead(
      db,
      (query) => (exclude.length ? query.not('id', 'in', `(${exclude.join(',')})`) : query),
      termIds,
      input.from,
      input.to
    ),
    input.permissions.affiliates
      ? countHead(db, (query) => query.in('id', inFilter(affiliateIds)), termIds, input.from, input.to)
      : Promise.resolve(null),
    input.permissions.vlb
      ? countHead(db, (query) => query.in('id', inFilter(investorIds)), termIds, input.from, input.to)
      : Promise.resolve(null),
  ]);

  return { all, regular, affiliate, investor };
}

async function listCustomersBuilder(
  db: CustomerClient,
  input: ListInput,
  parsed: ReturnType<typeof parseListInput>
) {
  const term = searchTerm(input.search || '');
  const termIds = await searchUserIds(db, term);
  if (termIds && termIds.length === 0) {
    return { rows: [], total: 0, counts: emptyCounts(input.permissions) };
  }

  const typeIds =
    parsed.type === 'regular'
      ? null
      : parsed.type === 'affiliate'
        ? await affiliateUserIds(db, parsed.affiliateStatus)
        : parsed.type === 'investor'
          ? await investorUserIds(db, parsed.investorStatus)
          : null;
  const exclude =
    parsed.type === 'regular'
      ? [...new Set([...(await affiliateUserIds(db)), ...(await investorUserIds(db))])]
      : null;

  const from = (input.page - 1) * input.limit;
  const to = from + input.limit - 1;

  // supabase-js builders are thenable. Do not mark this chain async/return it from
  // an async function, and do not await it until after .range().
  let query = (db.from('users') as any).select(customerSelect(), { count: 'exact' }).eq('role', 'customer');
  query = applyDates(query, input.from, input.to);
  if (termIds) query = query.in('id', inFilter(termIds));
  if (exclude?.length) query = query.not('id', 'in', `(${exclude.join(',')})`);
  if (typeIds) query = query.in('id', inFilter(typeIds));
  query = query.order('created_at', { ascending: parsed.sortAsc });
  const { data, error, count } = await query.range(from, to);
  if (error) {
    logDb('list', error);
    throw new CustomerError(500, 'Could not load customers.');
  }

  const [rows, counts] = await Promise.all([
    presentRows(db, (data || []) as EmbeddedUser[], input.permissions),
    customerTypeCountsBuilder(db, {
      search: input.search,
      from: input.from,
      to: input.to,
      permissions: input.permissions,
    }),
  ]);

  return { rows, total: count || 0, counts };
}

async function listCustomersRpc(
  db: CustomerClient,
  input: ListInput,
  parsed: ReturnType<typeof parseListInput>
) {
  const term = searchTerm(input.search || '') || null;
  const args = {
    p_type: parsed.type,
    p_affiliate_status: parsed.affiliateStatus,
    p_investor_status: parsed.investorStatus,
    p_search: term,
    p_from: dateFrom(input.from),
    p_to: dateToExclusive(input.to),
    p_sort: parsed.sortAsc ? 'oldest' : 'newest',
    p_limit: input.limit,
    p_offset: (input.page - 1) * input.limit,
  };
  const [list, counts] = await Promise.all([
    db.rpc('admin_list_customers', args),
    db.rpc('admin_customer_type_counts', {
      p_search: term,
      p_from: args.p_from,
      p_to: args.p_to,
    }),
  ]);
  if (isMissingRpc(list.error) || isMissingRpc(counts.error)) return null;
  if (list.error) {
    logDb('list rpc', list.error);
    throw new CustomerError(500, 'Could not load customers.');
  }
  if (counts.error) {
    logDb('counts rpc', counts.error);
    throw new CustomerError(500, 'Could not load customers.');
  }
  const rpcRows = asRows<RpcCustomer>(list.data);
  return {
    rows: rpcRows.map((row) => presentRpcRow(row, input.permissions)),
    total: rpcRows.length ? Number(rpcRows[0].total_count) || 0 : 0,
    counts: mapTypeCounts(counts.data, input.permissions),
  };
}

export async function customerTypeCounts(
  input: { search?: string; from?: string; to?: string; permissions: CustomerPermissions },
  db: CustomerClient = supabaseAdmin as unknown as CustomerClient
) {
  const term = searchTerm(input.search || '') || null;
  const rpc = await db.rpc('admin_customer_type_counts', {
    p_search: term,
    p_from: dateFrom(input.from),
    p_to: dateToExclusive(input.to),
  });
  if (!isMissingRpc(rpc.error)) {
    if (rpc.error) {
      logDb('counts rpc', rpc.error);
      throw new CustomerError(500, 'Could not load customers.');
    }
    return mapTypeCounts(rpc.data, input.permissions);
  }
  return customerTypeCountsBuilder(db, input);
}

export async function listCustomers(
  input: ListInput,
  db: CustomerClient = supabaseAdmin as unknown as CustomerClient
) {
  const parsed = parseListInput(input);
  const rpc = await listCustomersRpc(db, input, parsed);
  if (rpc) return rpc;
  return listCustomersBuilder(db, input, parsed);
}

export async function getCustomer(
  id: string,
  permissions: CustomerPermissions,
  db: CustomerClient = supabaseAdmin as unknown as CustomerClient
) {
  const { data, error } = await (db.from('users') as any)
    .select(customerSelect())
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logDb('get', error);
    throw new CustomerError(500, 'Could not load this customer.');
  }
  const row = data as EmbeddedUser | null;
  if (!row || !isListedCustomerRole(row.role)) {
    throw new CustomerError(404, 'Customer not found.');
  }
  const investor = first(row.investors);
  const investments = investor
    ? Array.from({ length: (await loadActiveCounts(db, [investor.id])).get(investor.id) || 0 }, () => ({
        status: 'active',
      }))
    : [];
  return presentCustomerDetail(row, row.affiliates, row.investors, investments, permissions);
}

export async function exportCustomersCsv(
  input: Omit<ListInput, 'page' | 'limit'>,
  db: CustomerClient = supabaseAdmin as unknown as CustomerClient
) {
  const listed = await listCustomers({ ...input, page: 1, limit: 10000 }, db);
  const headers = [
    'first_name',
    'last_name',
    'email',
    'phone',
    'newsletter_subscribed',
    'created_at',
    'type',
    'affiliate_no',
    'affiliate_status',
    'investor_no',
    'active_investments_count',
  ];
  return toCsv(
    headers,
    listed.rows.map((row) => [
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.newsletter_subscribed ? 'Yes' : 'No',
      row.created_at,
      csvTypeLabel(row),
      row.affiliate_no,
      row.affiliate_status,
      row.investor_no,
      row.active_investments_count,
    ])
  );
}

export { AFFILIATE_STATUSES, INVESTOR_STATUSES };
