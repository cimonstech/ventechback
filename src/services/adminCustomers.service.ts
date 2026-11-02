import { supabaseAdmin } from '../utils/supabaseClient';
import { toCsv } from './adminAffiliates.service';
import {
  AFFILIATE_STATUSES,
  CustomerPermissions,
  CustomerType,
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

function applyDates(query: any, from?: string, to?: string) {
  let next = query;
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    next = next.gte('created_at', `${from}T00:00:00.000Z`);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const end = new Date(`${to}T00:00:00.000Z`);
    if (!Number.isNaN(end.getTime())) {
      end.setUTCDate(end.getUTCDate() + 1);
      next = next.lt('created_at', end.toISOString());
    }
  }
  return next;
}

async function searchUserIds(term: string): Promise<string[] | null> {
  if (!term) return null;
  const [users, aff, inv] = await Promise.all([
    supabaseAdmin
      .from('users')
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
    supabaseAdmin.from('affiliates').select('user_id').ilike('affiliate_no', `%${term}%`),
    supabaseAdmin.from('investors').select('user_id').ilike('investor_no', `%${term}%`),
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

async function affiliateUserIds(status?: AffiliateStatus | null): Promise<string[]> {
  let query = supabaseAdmin.from('affiliates').select('user_id');
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) {
    logDb('affiliate ids', error);
    throw new CustomerError(500, 'Could not load customers.');
  }
  return (data || []).map((row) => row.user_id).filter(Boolean);
}

async function investorUserIds(status?: InvestorStatus | null): Promise<string[]> {
  const { data: investors, error } = await supabaseAdmin.from('investors').select('id, user_id');
  if (error) {
    logDb('investor ids', error);
    throw new CustomerError(500, 'Could not load customers.');
  }
  const rows = investors || [];
  if (!status) return rows.map((row: { id: string; user_id: string }) => row.user_id).filter(Boolean);

  const { data: live, error: liveError } = await supabaseAdmin
    .from('vlb_investments')
    .select('investor_id')
    .in('status', [...LIVE_INVESTMENT_STATUSES]);
  if (liveError) {
    logDb('live investments', liveError);
    throw new CustomerError(500, 'Could not load customers.');
  }
  const liveIds = new Set((live || []).map((row) => row.investor_id));

  if (status === 'active') {
    return rows.filter((row: { id: string; user_id: string }) => liveIds.has(row.id)).map((row: { user_id: string }) => row.user_id);
  }

  const { data: anyInv, error: anyError } = await supabaseAdmin.from('vlb_investments').select('investor_id');
  if (anyError) {
    logDb('any investments', anyError);
    throw new CustomerError(500, 'Could not load customers.');
  }
  const hasInvestment = new Set((anyInv || []).map((row) => row.investor_id));
  return rows
    .filter((row: { id: string; user_id: string }) => hasInvestment.has(row.id) && !liveIds.has(row.id))
    .map((row: { user_id: string }) => row.user_id);
}

async function excludeRegularUserIds(): Promise<string[]> {
  const [aff, inv] = await Promise.all([affiliateUserIds(), investorUserIds()]);
  return [...new Set([...aff, ...inv])];
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

async function applyTypeFilter(
  query: any,
  type: CustomerType,
  affiliateStatus: AffiliateStatus | null,
  investorStatus: InvestorStatus | null
) {
  if (type === 'regular') {
    const exclude = await excludeRegularUserIds();
    if (exclude.length) return query.not('id', 'in', `(${exclude.join(',')})`);
    return query;
  }
  if (type === 'affiliate') {
    const ids = await affiliateUserIds(affiliateStatus);
    return query.in('id', inFilter(ids));
  }
  if (type === 'investor') {
    const ids = await investorUserIds(investorStatus);
    return query.in('id', inFilter(ids));
  }
  return query;
}

function customerSelect() {
  return [
    'id, email, first_name, last_name, full_name, phone, role, created_at, newsletter_subscribed',
    'affiliates!affiliates_user_id_fkey(id, user_id, affiliate_no, status, created_at)',
    'investors!investors_user_id_fkey(id, user_id, investor_no, created_at)',
  ].join(', ');
}

async function loadActiveCounts(investorIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!investorIds.length) return counts;
  const { data, error } = await supabaseAdmin
    .from('vlb_investments')
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

async function presentRows(rows: EmbeddedUser[], permissions: CustomerPermissions) {
  const investorIds = rows
    .map((row) => first(row.investors)?.id)
    .filter((id): id is string => Boolean(id));
  const live = permissions.vlb ? await loadActiveCounts(investorIds) : new Map<string, number>();
  return rows.map((row) => {
    const investor = first(row.investors);
    const investments = investor
      ? Array.from({ length: live.get(investor.id) || 0 }, () => ({ status: 'active' }))
      : [];
    return presentCustomerRow(row, row.affiliates, row.investors, investments, permissions);
  });
}

async function scopedUsersQuery(termIds: string[] | null, from?: string, to?: string, sortAsc = false): Promise<any> {
  let query: any = supabaseAdmin.from('users').select(customerSelect(), { count: 'exact' }).eq('role', 'customer');
  query = applyDates(query, from, to);
  if (termIds) query = query.in('id', inFilter(termIds));
  query = query.order('created_at', { ascending: sortAsc });
  return query;
}

async function countScoped(
  extra: (query: any) => any | Promise<any>,
  termIds: string[] | null,
  from?: string,
  to?: string
): Promise<number> {
  let query = supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer');
  query = applyDates(query, from, to);
  if (termIds) query = query.in('id', inFilter(termIds));
  query = await extra(query);
  const { count, error } = await query;
  if (error) {
    logDb('count', error);
    throw new CustomerError(500, 'Could not load customers.');
  }
  return count || 0;
}

export async function customerTypeCounts(
  input: { search?: string; from?: string; to?: string; permissions: CustomerPermissions }
) {
  const term = searchTerm(input.search || '');
  const termIds = await searchUserIds(term);
  if (termIds && termIds.length === 0) {
    return {
      all: 0,
      regular: 0,
      affiliate: input.permissions.affiliates ? 0 : null,
      investor: input.permissions.vlb ? 0 : null,
    };
  }

  const [all, regular, affiliate, investor] = await Promise.all([
    countScoped(async (query) => query, termIds, input.from, input.to),
    countScoped(async (query) => applyTypeFilter(query, 'regular', null, null), termIds, input.from, input.to),
    input.permissions.affiliates
      ? countScoped(async (query) => applyTypeFilter(query, 'affiliate', null, null), termIds, input.from, input.to)
      : Promise.resolve(null),
    input.permissions.vlb
      ? countScoped(async (query) => applyTypeFilter(query, 'investor', null, null), termIds, input.from, input.to)
      : Promise.resolve(null),
  ]);

  return { all, regular, affiliate, investor };
}

export async function listCustomers(input: ListInput) {
  const { type, affiliateStatus, investorStatus, sortAsc } = parseListInput(input);
  const term = searchTerm(input.search || '');
  const termIds = await searchUserIds(term);
  const emptyCounts = {
    all: 0,
    regular: 0,
    affiliate: input.permissions.affiliates ? 0 : null,
    investor: input.permissions.vlb ? 0 : null,
  };
  if (termIds && termIds.length === 0) {
    return { rows: [], total: 0, counts: emptyCounts };
  }

  const from = (input.page - 1) * input.limit;
  const to = from + input.limit - 1;
  let query = await scopedUsersQuery(termIds, input.from, input.to, sortAsc);
  query = await applyTypeFilter(query, type, affiliateStatus, investorStatus);
  const { data, error, count } = await query.range(from, to);
  if (error) {
    logDb('list', error);
    throw new CustomerError(500, 'Could not load customers.');
  }

  const [rows, counts] = await Promise.all([
    presentRows((data || []) as EmbeddedUser[], input.permissions),
    customerTypeCounts({
      search: input.search,
      from: input.from,
      to: input.to,
      permissions: input.permissions,
    }),
  ]);

  return { rows, total: count || 0, counts };
}

export async function getCustomer(id: string, permissions: CustomerPermissions) {
  const { data, error } = await supabaseAdmin
    .from('users')
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
    ? Array.from({ length: (await loadActiveCounts([investor.id])).get(investor.id) || 0 }, () => ({
        status: 'active',
      }))
    : [];
  return presentCustomerDetail(row, row.affiliates, row.investors, investments, permissions);
}

export async function exportCustomersCsv(input: Omit<ListInput, 'page' | 'limit'>) {
  const listed = await listCustomers({ ...input, page: 1, limit: 10000 });
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
