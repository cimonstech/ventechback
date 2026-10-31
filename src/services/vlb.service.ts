import { Request } from 'express';
import { formatPesewas } from '../utils/money';
import { supabaseAdmin } from '../utils/supabaseClient';
import { logAudit } from './audit.service';
import { emailService, sendInvestmentEmail } from './email.service';
import { siteOrigin } from './affiliate.service';
import {
  ExtraRateByPeriod,
  ScheduleRow,
  buildSchedule,
  planSnapshotFields,
  snapshotFromPlan,
  totals,
} from './vlbCalc.service';
import { activationOnRepeat, renewOnRepeat, settleOnRepeat } from './vlbRepeat';

export { activationOnRepeat, renewOnRepeat, settleOnRepeat } from './vlbRepeat';

export class VlbError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'vlb_error',
    public errors: Record<string, string> | null = null
  ) {
    super(message);
    this.name = 'VlbError';
  }
}


type AuditReq = Request & { user?: { id?: string; role?: string } };

export interface VlbPlanRow {
  id: string;
  plan_group: 'vts' | 'exclusive';
  tier: string;
  name: string;
  principal_pesewas: number;
  version: string;
  is_active: boolean;
  sort_order: number;
  terms_count: number;
  months_per_term: number;
  settlement_months: number;
  term_rates_percent: Array<number | string>;
  rate_basis: 'per_month' | 'per_term';
  payout_frequency: 'monthly' | 'end_of_term';
  scholar_fund_percent: number | string;
  scholar_fund_basis: 'gross_payout' | 'principal';
  premium_stars: number;
  referral_bonus_percent: number | string;
  created_at: string;
  updated_at: string;
}

const MONEY_FIELDS = [
  'principal_pesewas',
  'terms_count',
  'months_per_term',
  'settlement_months',
  'term_rates_percent',
  'rate_basis',
  'payout_frequency',
  'scholar_fund_percent',
  'scholar_fund_basis',
  'referral_bonus_percent',
] as const;

type MoneyField = (typeof MONEY_FIELDS)[number];

export interface PlanWriteInput {
  plan_group?: 'vts' | 'exclusive';
  tier?: string;
  name?: string;
  principal_pesewas?: number;
  version?: string;
  is_active?: boolean;
  sort_order?: number;
  terms_count?: number;
  months_per_term?: number;
  settlement_months?: number;
  term_rates_percent?: number[];
  rate_basis?: 'per_month' | 'per_term';
  payout_frequency?: 'monthly' | 'end_of_term';
  scholar_fund_percent?: number;
  scholar_fund_basis?: 'gross_payout' | 'principal';
  premium_stars?: number;
  referral_bonus_percent?: number;
}

export interface ApplicationInput {
  full_name: string;
  email: string;
  phone: string;
  plan_id?: string | null;
  message?: string | null;
  user_id?: string | null;
  files?: Array<{ buffer: Buffer; size: number; originalname?: string }>;
}

export interface ActivateInput {
  email: string;
  plan_id: string;
  principal_pesewas: number;
  start_date: string;
  payment_method: string;
  payment_reference: string;
  agreement_signed_at: string;
  agreement_checked: boolean;
  allow_principal_override: boolean;
}

function logDb(scope: string, error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : String(error);
  console.error(`vlb ${scope}`, message);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pesewasLabel(pesewas: number): string {
  return formatPesewas(pesewas);
}

function ratesEqual(left: unknown, right: unknown): boolean {
  const a = Array.isArray(left) ? left.map(Number) : [];
  const b = Array.isArray(right) ? right.map(Number) : [];
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function moneyValueEqual(field: MoneyField, left: VlbPlanRow, right: PlanWriteInput): boolean {
  if (right[field] === undefined) return true;
  if (field === 'term_rates_percent') {
    return ratesEqual(left.term_rates_percent, right.term_rates_percent);
  }
  return Number(left[field]) === Number(right[field]);
}

function moneyFieldsChanged(current: VlbPlanRow, patch: PlanWriteInput): boolean {
  return MONEY_FIELDS.some((field) => !moneyValueEqual(field, current, patch));
}

function nextPlanVersion(current: string, taken: string[]): string {
  const takenSet = new Set(taken);
  const match = current.match(/^(V?)(\d+)\.(\d+)$/i);
  const prefix = match ? match[1] : 'V';
  let major = match ? Number(match[2]) : 3;
  let minor = match ? Number(match[3]) + 1 : 1;
  let candidate = `${prefix}${major}.${minor}`;
  while (takenSet.has(candidate)) {
    minor += 1;
    candidate = `${prefix}${major}.${minor}`;
  }
  return candidate;
}

function splitName(fullName: string): { first_name: string; last_name: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first_name = parts[0] || 'Investor';
  const last_name = parts.slice(1).join(' ') || first_name;
  return { first_name, last_name };
}

function inviteRedirect(): string {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    'https://ventechgadgets.com'
  ).replace(/\/$/, '');
  return `${base}/reset-password`;
}

async function findAuthUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      logDb('listUsers', error);
      throw new VlbError(500, 'Could not look up this investor.');
    }
    const found = data.users.find((user) => user.email?.toLowerCase() === normalized);
    if (found) return found;
    if (data.users.length < 200) return null;
  }
  return null;
}

function displayForPlan(plan: VlbPlanRow) {
  const snapshot = snapshotFromPlan(plan);
  const schedule = buildSchedule(snapshot, Number(plan.principal_pesewas), '2026-01-01');
  const t = totals(schedule);
  const monthlyNet = plan.payout_frequency === 'monthly'
    ? t.monthly_net
    : Math.round((t.term_totals[0] || 0) / Number(plan.months_per_term || 1));
  const returnMonths = Math.max(1, Number(plan.terms_count) * Number(plan.months_per_term));
  return {
    monthly_net_pesewas: monthlyNet,
    scholar_monthly_pesewas: Math.round(t.scholar_fund_total / returnMonths),
    term_totals_pesewas: t.term_totals,
    total_net_pesewas: t.total_net,
    scholar_fund_total_pesewas: t.scholar_fund_total,
    principal_pesewas: t.principal,
  };
}

export function presentPublicPlan(plan: VlbPlanRow) {
  return {
    id: plan.id,
    plan_group: plan.plan_group,
    tier: plan.tier,
    name: plan.name,
    version: plan.version,
    principal_pesewas: Number(plan.principal_pesewas),
    terms_count: Number(plan.terms_count),
    months_per_term: Number(plan.months_per_term),
    settlement_months: Number(plan.settlement_months),
    term_rates_percent: (plan.term_rates_percent || []).map(Number),
    rate_basis: plan.rate_basis,
    payout_frequency: plan.payout_frequency,
    scholar_fund_percent: Number(plan.scholar_fund_percent),
    scholar_fund_basis: plan.scholar_fund_basis,
    premium_stars: Number(plan.premium_stars),
    referral_bonus_percent: Number(plan.referral_bonus_percent),
    display: displayForPlan(plan),
  };
}

export async function loadPlan(id: string): Promise<VlbPlanRow> {
  const { data, error } = await supabaseAdmin
    .from('vlb_plans')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logDb('load plan', error);
    throw new VlbError(500, 'Could not load this plan.');
  }
  if (!data) throw new VlbError(404, 'Plan not found.');
  return data as VlbPlanRow;
}

async function planHasInvestments(planId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from('vlb_investments')
    .select('id', { count: 'exact', head: true })
    .eq('plan_id', planId);
  if (error) {
    logDb('count investments', error);
    throw new VlbError(500, 'Could not update this plan.');
  }
  return (count || 0) > 0;
}

export async function listPublicPlans() {
  const { data, error } = await supabaseAdmin
    .from('vlb_plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) {
    logDb('list public plans', error);
    throw new VlbError(500, 'Could not load plans.');
  }
  return (data as VlbPlanRow[] || []).map(presentPublicPlan);
}

export async function previewPlanSchedule(
  planId: string,
  principalPesewas: number | undefined,
  startDate: string
) {
  const plan = await loadPlan(planId);
  const amount = Number(principalPesewas || plan.principal_pesewas);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new VlbError(400, 'Enter a valid principal.');
  }
  const snapshot = snapshotFromPlan(plan);
  const schedule = buildSchedule(snapshot, amount, startDate);
  return {
    plan: presentPublicPlan({ ...plan, principal_pesewas: amount }),
    schedule,
    totals: totals(schedule),
  };
}

export async function listAdminPlans() {
  const { data, error } = await supabaseAdmin
    .from('vlb_plans')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('version', { ascending: true });
  if (error) {
    logDb('list admin plans', error);
    throw new VlbError(500, 'Could not load plans.');
  }
  return (data as VlbPlanRow[] || []).map((plan) => ({
    ...plan,
    principal_pesewas: Number(plan.principal_pesewas),
    term_rates_percent: (plan.term_rates_percent || []).map(Number),
    scholar_fund_percent: Number(plan.scholar_fund_percent),
    referral_bonus_percent: Number(plan.referral_bonus_percent),
    display: displayForPlan(plan),
  }));
}

export async function createPlan(req: AuditReq, input: PlanWriteInput) {
  const row = {
    plan_group: input.plan_group,
    tier: input.tier,
    name: input.name,
    principal_pesewas: input.principal_pesewas,
    version: input.version || 'V3.0',
    is_active: input.is_active ?? true,
    sort_order: input.sort_order ?? 0,
    terms_count: input.terms_count ?? 3,
    months_per_term: input.months_per_term ?? 3,
    settlement_months: input.settlement_months ?? 1,
    term_rates_percent: input.term_rates_percent ?? [8, 8, 8],
    rate_basis: input.rate_basis ?? 'per_month',
    payout_frequency: input.payout_frequency ?? 'monthly',
    scholar_fund_percent: input.scholar_fund_percent ?? 1,
    scholar_fund_basis: input.scholar_fund_basis ?? 'gross_payout',
    premium_stars: input.premium_stars ?? 5,
    referral_bonus_percent: input.referral_bonus_percent ?? 1,
  };
  if ((row.term_rates_percent || []).length !== Number(row.terms_count)) {
    throw new VlbError(400, 'Term rates must match the number of terms.');
  }
  const { data, error } = await supabaseAdmin
    .from('vlb_plans')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    logDb('create plan', error);
    if ((error as { code?: string }).code === '23505') {
      throw new VlbError(409, 'A plan with this group, tier, and version already exists.');
    }
    throw new VlbError(500, 'Could not create this plan.');
  }
  await logAudit({
    req,
    entity: 'vlb_plans',
    entityId: data.id,
    action: 'vlb_plan_created',
    after: data,
  });
  return data as VlbPlanRow;
}

export async function updatePlan(req: AuditReq, planId: string, patch: PlanWriteInput) {
  const current = await loadPlan(planId);
  if (patch.term_rates_percent && patch.terms_count == null) {
    if (patch.term_rates_percent.length !== Number(current.terms_count)) {
      throw new VlbError(400, 'Term rates must match the number of terms.');
    }
  }
  const termsCount = patch.terms_count ?? Number(current.terms_count);
  const rates = patch.term_rates_percent ?? (current.term_rates_percent || []).map(Number);
  if (rates.length !== termsCount) {
    throw new VlbError(400, 'Term rates must match the number of terms.');
  }

  const shouldVersion = moneyFieldsChanged(current, patch) && await planHasInvestments(planId);

  if (shouldVersion) {
    const { data: siblings, error: siblingError } = await supabaseAdmin
      .from('vlb_plans')
      .select('version')
      .eq('plan_group', current.plan_group)
      .eq('tier', current.tier);
    if (siblingError) {
      logDb('list plan versions', siblingError);
      throw new VlbError(500, 'Could not update this plan.');
    }
    const version = nextPlanVersion(
      current.version,
      (siblings || []).map((row: { version: string }) => row.version)
    );
    const row = {
      plan_group: patch.plan_group ?? current.plan_group,
      tier: patch.tier ?? current.tier,
      name: patch.name ?? current.name,
      principal_pesewas: patch.principal_pesewas ?? Number(current.principal_pesewas),
      version,
      is_active: patch.is_active ?? current.is_active,
      sort_order: patch.sort_order ?? current.sort_order,
      terms_count: termsCount,
      months_per_term: patch.months_per_term ?? Number(current.months_per_term),
      settlement_months: patch.settlement_months ?? Number(current.settlement_months),
      term_rates_percent: rates,
      rate_basis: patch.rate_basis ?? current.rate_basis,
      payout_frequency: patch.payout_frequency ?? current.payout_frequency,
      scholar_fund_percent: patch.scholar_fund_percent ?? Number(current.scholar_fund_percent),
      scholar_fund_basis: patch.scholar_fund_basis ?? current.scholar_fund_basis,
      premium_stars: patch.premium_stars ?? Number(current.premium_stars),
      referral_bonus_percent: patch.referral_bonus_percent ?? Number(current.referral_bonus_percent),
    };
    const { data, error } = await supabaseAdmin
      .from('vlb_plans')
      .insert(row)
      .select('*')
      .single();
    if (error) {
      logDb('version plan', error);
      if ((error as { code?: string }).code === '23505') {
        throw new VlbError(409, 'A plan with this group, tier, and version already exists.');
      }
      throw new VlbError(500, 'Could not update this plan.');
    }
    await logAudit({
      req,
      entity: 'vlb_plans',
      entityId: data.id,
      action: 'vlb_plan_versioned',
      before: current,
      after: data,
    });
    return { plan: data as VlbPlanRow, versioned: true };
  }

  const { data, error } = await supabaseAdmin
    .from('vlb_plans')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', planId)
    .select('*')
    .single();
  if (error) {
    logDb('update plan', error);
    if ((error as { code?: string }).code === '23505') {
      throw new VlbError(409, 'A plan with this group, tier, and version already exists.');
    }
    throw new VlbError(500, 'Could not update this plan.');
  }
  await logAudit({
    req,
    entity: 'vlb_plans',
    entityId: planId,
    action: 'vlb_plan_updated',
    before: current,
    after: data,
  });
  return { plan: data as VlbPlanRow, versioned: false };
}

async function resolveLegacyPlan(input: {
  tier?: string;
  amount?: string | number;
  plan?: string;
}): Promise<string | null> {
  const amountRaw = String(input.amount ?? '').replace(/,/g, '').trim();
  const ghs = Number(amountRaw);
  const principal = Number.isFinite(ghs) ? Math.round(ghs * 100) : 0;
  const group = /exclusive/i.test(String(input.plan || '')) || /exclusive/i.test(String(input.tier || ''))
    ? 'exclusive'
    : 'vts';
  const tierMatch = String(input.tier || '').match(/VIP\s*[123]/i);
  const tier = tierMatch ? `VIP ${tierMatch[0].replace(/VIP\s*/i, '')}` : '';

  let query = supabaseAdmin
    .from('vlb_plans')
    .select('id')
    .eq('is_active', true)
    .eq('plan_group', group)
    .order('version', { ascending: false });
  if (principal > 0) query = query.eq('principal_pesewas', principal);
  if (tier) query = query.eq('tier', tier);
  const { data, error } = await query.limit(1);
  if (error) {
    logDb('resolve legacy plan', error);
    return null;
  }
  return data?.[0]?.id ?? null;
}

async function insertApplication(input: ApplicationInput) {
  const { data, error } = await supabaseAdmin
    .from('vlb_applications')
    .insert({
      user_id: input.user_id || null,
      full_name: input.full_name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      plan_id: input.plan_id || null,
      message: input.message?.trim() || null,
      status: 'new',
    })
    .select('*')
    .single();
  if (error) {
    logDb('insert application', error);
    throw new VlbError(500, 'Could not save this application.');
  }
  return data;
}

async function emailApplicantReceived(input: {
  to: string;
  fullName: string;
  uploadUrl?: string | null;
  hasAgreement: boolean;
}) {
  const origin = siteOrigin();
  const uploadBlock = !input.hasAgreement && input.uploadUrl
    ? `<p>Please upload your signed agreement so we can activate your investment.</p>
      <p style="margin:24px 0;"><a href="${escapeHtml(input.uploadUrl)}" style="display:inline-block;background:#FF7A19;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Upload your signed agreement</a></p>
      <p style="color:#666;font-size:12px;">This link is valid for 14 days. You can add more pages until we activate or decline the application.</p>`
    : input.hasAgreement
      ? '<p>We have received your signed agreement. We will contact you shortly.</p>'
      : '<p>We will contact you shortly.</p>';
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1A1A1A;max-width:600px;margin:0 auto;">
      <h1 style="color:#FF7A19;font-size:22px;">We've received your Laptop Banking application</h1>
      <p>Hi ${escapeHtml(input.fullName || 'there')},</p>
      <p>Thank you for applying to VENTECH Laptop Banking.</p>
      ${uploadBlock}
      ${origin ? `<p><a href="${escapeHtml(`${origin}/laptop-banking`)}" style="color:#FF7A19;">View Laptop Banking</a></p>` : ''}
      <p style="color:#666;font-size:12px;margin-top:32px;">VENTECH Gadgets</p>
    </div>
  `;
  const sent = await emailService.sendEmail({
    to: input.to,
    subject: "We've received your Laptop Banking application",
    html,
  }, true);
  if (!sent) {
    console.error('vlb applicant confirmation email failed');
  }
}

export async function submitApplication(input: ApplicationInput, req?: AuditReq) {
  if (!input.plan_id) throw new VlbError(400, 'Select a plan.');
  const plan = await loadPlan(input.plan_id);
  if (!plan.is_active) throw new VlbError(400, 'This plan is not available.');
  const application = await insertApplication(input);
  const { saveUploadToken, storeAgreementFiles, uploadPageUrl, applicationHasSignedAgreement } = await import('./vlbApplicationFiles.service');
  const issued = await saveUploadToken(application.id);
  if (input.files?.length) {
    await storeAgreementFiles(req || ({} as AuditReq), application.id, input.files, 'application_form');
  }
  const hasAgreement = await applicationHasSignedAgreement(application.id);
  const amountGhs = (Number(plan.principal_pesewas) / 100).toLocaleString('en-US');
  const storeResult = await sendInvestmentEmail({
    fullName: input.full_name,
    email: input.email,
    phone: input.phone,
    tier: `${plan.name} (${plan.version})`,
    amount: amountGhs,
    plan: plan.plan_group === 'vts' ? 'VTS Banking' : 'Exclusive Banking',
    message: input.message || '',
  });
  if (!storeResult.success) {
    console.error('vlb store notification email failed');
  }
  await emailApplicantReceived({
    to: input.email,
    fullName: input.full_name,
    uploadUrl: uploadPageUrl(issued.token),
    hasAgreement,
  });
  return { ...application, upload_token: issued.token, has_signed_agreement: hasAgreement };
}

export async function submitLegacyInvestment(input: {
  fullName: string;
  email: string;
  phone: string;
  tier: string;
  amount: string | number;
  plan: string;
  message?: string;
  user_id?: string | null;
}) {
  const planId = await resolveLegacyPlan(input);
  try {
    await insertApplication({
      full_name: input.fullName,
      email: input.email,
      phone: input.phone,
      plan_id: planId,
      message: input.message,
      user_id: input.user_id,
    });
  } catch (error) {
    logDb('legacy application store', error);
  }
  const storeResult = await sendInvestmentEmail({
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    tier: input.tier,
    amount: input.amount,
    plan: input.plan,
    message: input.message,
  });
  if (storeResult.success) {
    try {
      await emailApplicantReceived({
        to: input.email,
        fullName: input.fullName,
        hasAgreement: false,
      });
    } catch (error) {
      console.error('vlb legacy applicant email failed', error);
    }
  }
  return storeResult;
}

async function ensureInvestorUser(input: {
  email: string;
  fullName: string;
  phone?: string | null;
}) {
  const email = input.email.trim().toLowerCase();
  const names = splitName(input.fullName);

  const { data: existingProfile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (profileError) {
    logDb('load user by email', profileError);
    throw new VlbError(500, 'Could not look up this investor.');
  }

  let authUserId = existingProfile?.id as string | undefined;
  if (!authUserId) {
    const existingAuth = await findAuthUserByEmail(email);
    if (existingAuth) {
      authUserId = existingAuth.id;
    } else {
      const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: inviteRedirect(),
        data: {
          first_name: names.first_name,
          last_name: names.last_name,
        },
      });
      if (inviteError || !invited?.user) {
        const already = String(inviteError?.message || '').toLowerCase().includes('already');
        if (!already) {
          logDb('inviteUserByEmail', inviteError);
          throw new VlbError(400, 'Could not invite this investor.');
        }
        const found = await findAuthUserByEmail(email);
        if (!found) {
          throw new VlbError(409, 'A user with this email exists but could not be loaded.');
        }
        authUserId = found.id;
      } else {
        authUserId = invited.user.id;
      }
    }
  }

  const { data: byId, error: byIdError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', authUserId)
    .maybeSingle();
  if (byIdError) {
    logDb('load user by id', byIdError);
    throw new VlbError(500, 'Could not look up this investor.');
  }

  const keepRole = byId?.role && ['staff', 'admin', 'superadmin'].includes(byId.role)
    ? byId.role
    : 'customer';
  const firstName = byId?.first_name || names.first_name;
  const lastName = byId?.last_name || names.last_name;
  const fullName = `${firstName} ${lastName}`.trim();
  const phone = byId?.phone || input.phone || null;

  if (byId) {
    const { error } = await supabaseAdmin
      .from('users')
      .update({
        email,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        phone,
        role: keepRole,
        updated_at: new Date().toISOString(),
      })
      .eq('id', byId.id);
    if (error) {
      logDb('update investor profile', error);
      throw new VlbError(500, 'Could not save this investor.');
    }
    return byId.id as string;
  }

  const { error } = await supabaseAdmin.from('users').insert({
    id: authUserId,
    email,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    phone,
    role: 'customer',
  });
  if (error) {
    logDb('insert investor profile', error);
    throw new VlbError(500, 'Could not save this investor.');
  }
  return authUserId as string;
}

function rpcMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message || '');
  }
  return '';
}

async function emailInvestmentActive(input: {
  to: string;
  fullName: string;
  investorNo: string;
  planName: string;
  principalPesewas: number;
  startDate: string;
  maturityDate: string;
  schedule: ScheduleRow[];
}) {
  const origin = siteOrigin();
  const link = origin ? `${origin}/account/investments` : '/account/investments';
  const t = totals(input.schedule);
  const rowsHtml = input.schedule
    .map((row) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(row.due_date)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(row.type)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${escapeHtml(pesewasLabel(row.net_pesewas))}</td>
      </tr>`)
    .join('');
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1A1A1A;max-width:640px;margin:0 auto;">
      <h1 style="color:#FF7A19;font-size:22px;">Your Laptop Banking investment is active</h1>
      <p>Hi ${escapeHtml(input.fullName || 'there')},</p>
      <p>Your ${escapeHtml(input.planName)} investment (${escapeHtml(input.investorNo)}) is now active.</p>
      <p><strong>Principal:</strong> ${escapeHtml(pesewasLabel(input.principalPesewas))}<br>
         <strong>Start:</strong> ${escapeHtml(input.startDate)}<br>
         <strong>Maturity:</strong> ${escapeHtml(input.maturityDate)}<br>
         <strong>Total net returns:</strong> ${escapeHtml(pesewasLabel(t.total_net))}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #FF7A19;">Due</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #FF7A19;">Type</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #FF7A19;">Net</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="margin:24px 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#FF7A19;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">View your investments</a></p>
      <p style="color:#666;font-size:12px;">VENTECH Gadgets</p>
    </div>
  `;
  const sent = await emailService.sendEmail({
    to: input.to,
    subject: 'Your Laptop Banking investment is active',
    html,
  }, true);
  if (!sent) console.error('vlb activation email failed');
}

export async function activateApplication(
  req: AuditReq,
  applicationId: string,
  input: ActivateInput
) {
  const { data: application, error: appError } = await supabaseAdmin
    .from('vlb_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();
  if (appError) {
    logDb('load application', appError);
    throw new VlbError(500, 'Could not load this application.');
  }
  if (!application) throw new VlbError(404, 'Application not found.');
  const repeat = activationOnRepeat(application.status);
  if (repeat === 'declined') {
    throw new VlbError(400, 'This application was declined.');
  }
  if (repeat === 'proceed') {
    const { applicationHasSignedAgreement } = await import('./vlbApplicationFiles.service');
    const hasFile = await applicationHasSignedAgreement(applicationId);
    if (!hasFile) {
      throw new VlbError(422, 'Upload the signed agreement before activating.', 'agreement_missing');
    }
    if (!input.agreement_checked) {
      throw new VlbError(400, 'Confirm you have checked the signed agreement is complete and signed.', 'validation', {
        agreement_checked: 'Confirm you have checked the signed agreement is complete and signed.',
      });
    }
  }
  if (repeat === 'return_existing') {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('vlb_investments')
      .select('id, investor_id, application_id, investors(investor_no)')
      .eq('application_id', applicationId)
      .maybeSingle();
    if (existingError) {
      logDb('load existing activation', existingError);
      throw new VlbError(500, 'Could not load this application.');
    }
    if (!existing) throw new VlbError(409, 'This application is already activated.');
    const investor = Array.isArray(existing.investors) ? existing.investors[0] : existing.investors;
    return {
      investment_id: existing.id,
      investor_id: existing.investor_id,
      investor_no: (investor as { investor_no?: string } | null)?.investor_no || '',
      application_id: applicationId,
    };
  }

  const plan = await loadPlan(input.plan_id);
  if (!input.allow_principal_override && Number(input.principal_pesewas) !== Number(plan.principal_pesewas)) {
    throw new VlbError(400, 'Principal must match the plan amount.');
  }

  const snapshot = snapshotFromPlan(plan);
  const extraRateByPeriod: ExtraRateByPeriod | undefined = undefined;
  const schedule = buildSchedule(
    snapshot,
    input.principal_pesewas,
    input.start_date,
    extraRateByPeriod
  );
  const returnPeriods = snapshot.terms_count * snapshot.months_per_term;
  const maturityDate = schedule.find((row) => row.type === 'principal')?.due_date
    || schedule[schedule.length - 1].due_date;
  const planSnapshot = planSnapshotFields(plan);
  const userId = await ensureInvestorUser({
    email: input.email,
    fullName: application.full_name,
    phone: application.phone,
  });

  const { data, error } = await supabaseAdmin.rpc('activate_vlb_investment', {
    p_application_id: applicationId,
    p_user_id: userId,
    p_plan_id: plan.id,
    p_principal_pesewas: input.principal_pesewas,
    p_start_date: input.start_date,
    p_maturity_date: maturityDate,
    p_plan_snapshot: planSnapshot,
    p_payouts: schedule,
    p_payment_method: input.payment_method,
    p_payment_reference: input.payment_reference,
    p_agreement_signed_at: input.agreement_signed_at,
    p_stars_total: Number(plan.premium_stars),
    p_activated_by: req.user?.id || null,
    p_allow_principal_override: input.allow_principal_override,
  });

  if (error) {
    const message = rpcMessage(error);
    logDb('activate_vlb_investment', error);
    if (message.includes('Application not found')) throw new VlbError(404, 'Application not found.');
    if (message.includes('already activated')) throw new VlbError(409, 'This application is already activated.');
    if (message.includes('was declined')) throw new VlbError(400, 'This application was declined.');
    if (message.includes('Plan not found')) throw new VlbError(404, 'Plan not found.');
    if (message.includes('Principal must match')) throw new VlbError(400, 'Principal must match the plan amount.');
    if (message.includes('User not found')) throw new VlbError(400, 'Could not save this investor.');
    if (message.includes('Payout schedule is missing')) throw new VlbError(400, 'Payout schedule is missing.');
    throw new VlbError(500, 'Could not activate this investment.');
  }

  const result = data as {
    investment_id: string;
    investor_id: string;
    investor_no: string;
    application_id: string;
  };

  await logAudit({
    req,
    entity: 'vlb_investments',
    entityId: result.investment_id,
    action: 'vlb_investment_activated',
    before: application,
    after: {
      ...result,
      plan_id: plan.id,
      principal_pesewas: input.principal_pesewas,
      start_date: input.start_date,
      return_periods: returnPeriods,
    },
  });

  await emailInvestmentActive({
    to: input.email,
    fullName: application.full_name,
    investorNo: result.investor_no,
    planName: plan.name,
    principalPesewas: input.principal_pesewas,
    startDate: input.start_date,
    maturityDate,
    schedule,
  });

  try {
    const { copySignedAgreementToInvestor } = await import('./vlbApplicationFiles.service');
    await copySignedAgreementToInvestor({
      applicationId,
      investorId: result.investor_id,
      investmentId: result.investment_id,
      uploadedBy: req.user?.id || null,
    });
  } catch (error) {
    logDb('copy signed agreement', error);
    throw error;
  }

  return {
    ...result,
    schedule,
    totals: totals(schedule),
  };
}

export async function markDuePayouts(today: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('vlb_payouts')
    .update({ status: 'due' })
    .eq('status', 'scheduled')
    .lte('due_date', today)
    .select('id');
  if (error) {
    logDb('markDuePayouts', error);
    throw new VlbError(500, 'Could not mark due payouts.');
  }
  return data?.length ?? 0;
}

export async function moveToSettlement(today: string): Promise<number> {
  const { data: active, error: activeError } = await supabaseAdmin
    .from('vlb_investments')
    .select('id')
    .eq('status', 'active');
  if (activeError) {
    logDb('moveToSettlement load', activeError);
    throw new VlbError(500, 'Could not move investments to settlement.');
  }
  const ids = (active || []).map((row: { id: string }) => row.id);
  if (ids.length === 0) return 0;

  const { data: payouts, error: payoutError } = await supabaseAdmin
    .from('vlb_payouts')
    .select('investment_id, due_date')
    .eq('type', 'return')
    .in('investment_id', ids);
  if (payoutError) {
    logDb('moveToSettlement payouts', payoutError);
    throw new VlbError(500, 'Could not move investments to settlement.');
  }

  const lastReturn = new Map<string, string>();
  for (const row of payouts || []) {
    const current = lastReturn.get(row.investment_id);
    if (!current || row.due_date > current) lastReturn.set(row.investment_id, row.due_date);
  }

  const ready = ids.filter((id) => {
    const due = lastReturn.get(id);
    return due != null && due <= today;
  });
  if (ready.length === 0) return 0;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('vlb_investments')
    .update({ status: 'settlement' })
    .eq('status', 'active')
    .in('id', ready)
    .select('id');
  if (updateError) {
    logDb('moveToSettlement update', updateError);
    throw new VlbError(500, 'Could not move investments to settlement.');
  }
  return updated?.length ?? 0;
}
