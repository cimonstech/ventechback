export const CUSTOMER_TYPES = ['all', 'regular', 'affiliate', 'investor'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const AFFILIATE_STATUSES = [
  'awaiting_payment',
  'pending',
  'active',
  'suspended',
  'rejected',
] as const;
export type AffiliateStatus = (typeof AFFILIATE_STATUSES)[number];

export const INVESTOR_STATUSES = ['active', 'past'] as const;
export type InvestorStatus = (typeof INVESTOR_STATUSES)[number];

export const LIVE_INVESTMENT_STATUSES = ['active', 'settlement'] as const;

export type CustomerUser = {
  id: string;
  role: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  phone?: string | null;
  created_at: string;
  newsletter_subscribed?: boolean | null;
};

export type AffiliateLink = {
  id: string;
  user_id: string;
  affiliate_no: string | null;
  status: string;
  created_at: string;
};

export type InvestorLink = {
  id: string;
  user_id: string;
  investor_no: string | null;
  created_at: string;
};

export type InvestmentLink = {
  investor_id: string;
  status: string;
};

export type CustomerPermissions = {
  affiliates: boolean;
  vlb: boolean;
};

export function isListedCustomerRole(role: string | null | undefined): boolean {
  return role === 'customer';
}

export function parseCustomerType(value: string | undefined | null): CustomerType | null {
  if (!value || value === 'all') return 'all';
  if (value === 'regular' || value === 'affiliate' || value === 'investor') return value;
  return null;
}

export function parseAffiliateStatus(value: string | undefined | null): AffiliateStatus | null {
  if (!value) return null;
  return (AFFILIATE_STATUSES as readonly string[]).includes(value) ? (value as AffiliateStatus) : null;
}

export function parseInvestorStatus(value: string | undefined | null): InvestorStatus | null {
  if (!value) return null;
  return (INVESTOR_STATUSES as readonly string[]).includes(value) ? (value as InvestorStatus) : null;
}

export function resolveTypeFilter(
  requested: string | undefined | null,
  permissions: CustomerPermissions
): CustomerType {
  const parsed = parseCustomerType(requested);
  const type = parsed || 'all';
  if (type === 'affiliate' && !permissions.affiliates) return 'all';
  if (type === 'investor' && !permissions.vlb) return 'all';
  return type;
}

export function investorBucket(investments: Array<{ status: string }>): InvestorStatus | null {
  if (!investments.length) return null;
  if (investments.some((row) => LIVE_INVESTMENT_STATUSES.includes(row.status as (typeof LIVE_INVESTMENT_STATUSES)[number]))) {
    return 'active';
  }
  return 'past';
}

export function activeInvestmentsCount(investments: Array<{ status: string }>): number {
  return investments.filter((row) =>
    LIVE_INVESTMENT_STATUSES.includes(row.status as (typeof LIVE_INVESTMENT_STATUSES)[number])
  ).length;
}

function oneAffiliate(rows: AffiliateLink[] | AffiliateLink | null | undefined): AffiliateLink | null {
  if (!rows) return null;
  return Array.isArray(rows) ? rows[0] || null : rows;
}

function oneInvestor(rows: InvestorLink[] | InvestorLink | null | undefined): InvestorLink | null {
  if (!rows) return null;
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export function presentCustomerRow(
  user: CustomerUser,
  affiliate: AffiliateLink[] | AffiliateLink | null | undefined,
  investor: InvestorLink[] | InvestorLink | null | undefined,
  investments: Array<{ status: string }>,
  permissions: CustomerPermissions
) {
  const aff = oneAffiliate(affiliate);
  const inv = oneInvestor(investor);
  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    full_name: user.full_name || null,
    phone: user.phone || null,
    created_at: user.created_at,
    newsletter_subscribed: Boolean(user.newsletter_subscribed),
    is_affiliate: permissions.affiliates ? Boolean(aff) : null,
    affiliate_no: permissions.affiliates ? aff?.affiliate_no || null : null,
    affiliate_status: permissions.affiliates ? aff?.status || null : null,
    is_investor: permissions.vlb ? Boolean(inv) : null,
    investor_no: permissions.vlb ? inv?.investor_no || null : null,
    active_investments_count: permissions.vlb ? (inv ? activeInvestmentsCount(investments) : 0) : null,
  };
}

export function presentCustomerDetail(
  user: CustomerUser,
  affiliate: AffiliateLink[] | AffiliateLink | null | undefined,
  investor: InvestorLink[] | InvestorLink | null | undefined,
  investments: Array<{ status: string }>,
  permissions: CustomerPermissions
) {
  const row = presentCustomerRow(user, affiliate, investor, investments, permissions);
  const aff = oneAffiliate(affiliate);
  const inv = oneInvestor(investor);
  return {
    ...row,
    affiliate:
      permissions.affiliates && aff
        ? {
            id: aff.id,
            affiliate_no: aff.affiliate_no,
            status: aff.status,
            created_at: aff.created_at,
          }
        : null,
    investor:
      permissions.vlb && inv
        ? {
            id: inv.id,
            investor_no: inv.investor_no,
            active_investments_count: activeInvestmentsCount(investments),
          }
        : null,
  };
}

export function csvTypeLabel(row: {
  is_affiliate: boolean | null;
  is_investor: boolean | null;
}): string {
  const parts: string[] = [];
  if (row.is_affiliate) parts.push('Affiliate');
  if (row.is_investor) parts.push('Investor');
  if (!parts.length) parts.push('Customer');
  return parts.join('; ');
}

export type CustomerQueryInput = {
  type: CustomerType;
  affiliateStatus?: AffiliateStatus | null;
  investorStatus?: InvestorStatus | null;
  search?: string;
  from?: string | null;
  to?: string | null;
};

function matchesSearch(user: CustomerUser, affiliate: AffiliateLink | null, investor: InvestorLink | null, term: string): boolean {
  if (!term) return true;
  const hay = [
    user.email,
    user.first_name,
    user.last_name,
    user.full_name,
    user.phone,
    user.id,
    affiliate?.affiliate_no,
    investor?.investor_no,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(term.toLowerCase());
}

function inDateRange(createdAt: string, from?: string | null, to?: string | null): boolean {
  const time = Date.parse(createdAt);
  if (Number.isNaN(time)) return false;
  if (from) {
    const start = Date.parse(`${from}T00:00:00.000Z`);
    if (!Number.isNaN(start) && time < start) return false;
  }
  if (to) {
    const end = Date.parse(`${to}T23:59:59.999Z`);
    if (!Number.isNaN(end) && time > end) return false;
  }
  return true;
}

export function matchesType(
  type: CustomerType,
  affiliate: AffiliateLink | null,
  investor: InvestorLink | null,
  investments: Array<{ status: string }>,
  affiliateStatus?: AffiliateStatus | null,
  investorStatus?: InvestorStatus | null
): boolean {
  if (type === 'regular') return !affiliate && !investor;
  if (type === 'affiliate') {
    if (!affiliate) return false;
    if (affiliateStatus && affiliate.status !== affiliateStatus) return false;
    return true;
  }
  if (type === 'investor') {
    if (!investor) return false;
    if (!investorStatus) return true;
    return investorBucket(investments) === investorStatus;
  }
  return true;
}

export function queryCustomers(
  users: CustomerUser[],
  affiliates: AffiliateLink[],
  investors: InvestorLink[],
  investments: InvestmentLink[],
  input: CustomerQueryInput,
  permissions: CustomerPermissions
) {
  const type = resolveTypeFilter(input.type, permissions);
  const affiliateByUser = new Map(affiliates.map((row) => [row.user_id, row]));
  const investorByUser = new Map(investors.map((row) => [row.user_id, row]));
  const investmentsByInvestor = new Map<string, InvestmentLink[]>();
  for (const row of investments) {
    const list = investmentsByInvestor.get(row.investor_id) || [];
    list.push(row);
    investmentsByInvestor.set(row.investor_id, list);
  }

  const listed = users.filter((user) => isListedCustomerRole(user.role));
  const scoped = listed.filter((user) => {
    if (!inDateRange(user.created_at, input.from, input.to)) return false;
    const affiliate = affiliateByUser.get(user.id) || null;
    const investor = investorByUser.get(user.id) || null;
    if (!matchesSearch(user, affiliate, investor, input.search || '')) return false;
    return true;
  });

  const counts = {
    all: scoped.length,
    regular: scoped.filter((user) => !affiliateByUser.has(user.id) && !investorByUser.has(user.id)).length,
    affiliate: permissions.affiliates ? scoped.filter((user) => affiliateByUser.has(user.id)).length : null,
    investor: permissions.vlb ? scoped.filter((user) => investorByUser.has(user.id)).length : null,
  };

  const rows = scoped
    .filter((user) => {
      const affiliate = affiliateByUser.get(user.id) || null;
      const investor = investorByUser.get(user.id) || null;
      const invRows = investor ? investmentsByInvestor.get(investor.id) || [] : [];
      return matchesType(type, affiliate, investor, invRows, input.affiliateStatus, input.investorStatus);
    })
    .map((user) => {
      const affiliate = affiliateByUser.get(user.id) || null;
      const investor = investorByUser.get(user.id) || null;
      const invRows = investor ? investmentsByInvestor.get(investor.id) || [] : [];
      return presentCustomerRow(user, affiliate, investor, invRows, permissions);
    });

  return { rows, counts };
}
