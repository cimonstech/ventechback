import {
  button,
  detailsTable,
  heading,
  joinText,
  lineItemsTable,
  nextSteps,
  paragraph,
  secondaryLink,
  statusBadge,
  textButton,
  textDetails,
  textHeading,
  textLineItems,
  textNextSteps,
  textParagraph,
  textSecondaryLink,
  textTotals,
  totalsBlock,
} from '../components';
import {
  contactUrl,
  enumLabel,
  formatDateAccra,
  formatMoneyGhs,
  formatMoneyPesewas,
  greeting,
  investmentsUrl,
} from '../copy';
import { renderEmail } from '../layout';
import type { EmailLineItem, RenderedEmail } from '../types';

export function vlbApplicationReceived(input: {
  firstName?: string;
  uploadUrl?: string | null;
  hasAgreement: boolean;
}): RenderedEmail {
  const headingText = 'We have your Laptop Banking application';
  const next = input.hasAgreement
    ? ['We review the signed agreement.', 'We email you when the investment is active.']
    : input.uploadUrl
      ? ['Download the blank agreement and sign every page.', 'Upload a clear scan or photos with the button below.', 'The upload link is valid for 14 days.']
      : ['We will contact you shortly.'];
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph('Thank you for applying to VENTECH Laptop Banking.'),
    input.hasAgreement
      ? paragraph('We have received your signed agreement.')
      : paragraph('Upload your signed agreement so we can activate your investment.'),
    nextSteps(next),
    input.uploadUrl && !input.hasAgreement
      ? button('Upload your signed agreement', input.uploadUrl)
      : button('View Laptop Banking', investmentsUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph('Thank you for applying to VENTECH Laptop Banking.'),
    textNextSteps(next),
    input.uploadUrl && !input.hasAgreement
      ? textButton('Upload your signed agreement', input.uploadUrl)
      : textButton('View Laptop Banking', investmentsUrl()),
  ]);
  return renderEmail({
    id: 'vlb-application-received',
    subject: 'We have your Laptop Banking application',
    preheader: input.hasAgreement
      ? 'We have your signed agreement and will be in touch.'
      : 'Upload your signed agreement so we can activate your investment.',
    bodyHtml: html,
    bodyText: text,
  });
}

export function vlbAgreementUpload(input: {
  firstName?: string;
  uploadUrl: string;
  message?: string | null;
}): RenderedEmail {
  const headingText = 'Upload your signed Laptop Banking agreement';
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph('Download the blank agreement, sign it, and upload a clear scan or photos of every page.'),
    input.message ? paragraph(input.message) : '',
    paragraph('This link is valid for 14 days.'),
    button('Upload your signed agreement', input.uploadUrl),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph('Download the blank agreement, sign it, and upload a clear scan or photos of every page.'),
    input.message || '',
    textButton('Upload your signed agreement', input.uploadUrl),
  ]);
  return renderEmail({
    id: 'vlb-agreement-upload',
    subject: 'Upload your signed Laptop Banking agreement',
    preheader: 'The upload link is valid for 14 days.',
    bodyHtml: html,
    bodyText: text,
  });
}

export function vlbInvestmentActive(input: {
  firstName?: string;
  planName: string;
  investorNo: string;
  principalPesewas: number;
  startDate: string;
  maturityDate: string;
  totalNetPesewas: number;
  investmentId?: string;
  schedule: Array<{ due: string; type: string; netPesewas: number }>;
}): RenderedEmail {
  const headingText = 'Your Laptop Banking investment is active';
  const items: EmailLineItem[] = input.schedule.map((row) => ({
    name: `${formatDateAccra(row.due) || row.due} \u00B7 ${enumLabel(row.type)}`,
    quantity: 1,
    unitPrice: row.netPesewas / 100,
    lineTotal: row.netPesewas / 100,
  }));
  const href = investmentsUrl(input.investmentId);
  const details = [
    { label: 'Investor', value: input.investorNo },
    { label: 'Plan', value: input.planName },
    { label: 'Principal', value: formatMoneyPesewas(input.principalPesewas) },
    { label: 'Start', value: formatDateAccra(input.startDate) },
    { label: 'Maturity', value: formatDateAccra(input.maturityDate) },
    { label: 'Total net returns', value: formatMoneyPesewas(input.totalNetPesewas) },
  ];
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`Your ${input.planName} investment (${input.investorNo}) is now active.`),
    `<p style="margin:0 0 16px;">${statusBadge('Active', 'success')}</p>`,
    detailsTable(details),
    items.length ? lineItemsTable(items) : '',
    button('View your investments', href),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`Your ${input.planName} investment (${input.investorNo}) is now active.`),
    textDetails(details),
    items.length ? textLineItems(items) : '',
    textButton('View your investments', href),
  ]);
  return renderEmail({
    id: 'vlb-investment-active',
    subject: 'Your Laptop Banking investment is active',
    preheader: `${input.planName} (${input.investorNo}) is active.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function vlbPayoutDue(input: {
  firstName?: string;
  amountPesewas: number;
  investmentId?: string;
}): RenderedEmail {
  const amount = formatMoneyPesewas(input.amountPesewas);
  const headingText = `Your payout of ${amount} is due today`;
  const href = investmentsUrl(input.investmentId);
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`Your payout of ${amount} is due today. We will process it to your saved payout details.`),
    button('View your investments', href),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`Your payout of ${amount} is due today. We will process it to your saved payout details.`),
    textButton('View your investments', href),
  ]);
  return renderEmail({
    id: 'vlb-payout-due',
    subject: `Your payout of ${amount} is due today`,
    preheader: `${amount} is due today on your Laptop Banking investment.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function vlbPayoutPaid(input: {
  firstName?: string;
  netPesewas: number;
  grossPesewas: number;
  scholarPesewas: number;
  periodLabel: string;
  method: string;
  reference: string;
}): RenderedEmail {
  const net = formatMoneyPesewas(input.netPesewas);
  const headingText = `Your payout of ${net} was paid`;
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`We sent ${net} (net) for ${input.periodLabel}.`),
    detailsTable([
      { label: 'Gross', value: formatMoneyPesewas(input.grossPesewas) },
      { label: 'Scholar Fund', value: formatMoneyPesewas(input.scholarPesewas) },
      { label: 'Net', value: net },
      { label: 'Method', value: enumLabel(input.method) },
      { label: 'Reference', value: input.reference },
    ]),
    button('View your investments', investmentsUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`We sent ${net} (net) for ${input.periodLabel}.`),
    textDetails([
      { label: 'Gross', value: formatMoneyPesewas(input.grossPesewas) },
      { label: 'Scholar Fund', value: formatMoneyPesewas(input.scholarPesewas) },
      { label: 'Net', value: net },
      { label: 'Method', value: enumLabel(input.method) },
      { label: 'Reference', value: input.reference },
    ]),
    textButton('View your investments', investmentsUrl()),
  ]);
  return renderEmail({
    id: 'vlb-payout-paid',
    subject: `Payout paid: ${net}`,
    preheader: `${net} (net) sent for ${input.periodLabel}.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function vlbSettlement(input: {
  firstName?: string;
  principalPesewas: number;
  investmentId?: string;
}): RenderedEmail {
  const amount = formatMoneyPesewas(input.principalPesewas);
  const headingText = 'Your Laptop Banking investment is in settlement';
  const href = investmentsUrl(input.investmentId);
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`Your Laptop Banking investment of ${amount} has entered its settlement month.`),
    paragraph('Choose to settle or renew in your account. If you do not choose, your principal will be paid out.'),
    button('Choose settle or renew', href),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`Your Laptop Banking investment of ${amount} has entered its settlement month.`),
    textParagraph('Choose to settle or renew in your account. If you do not choose, your principal will be paid out.'),
    textButton('Choose settle or renew', href),
  ]);
  return renderEmail({
    id: 'vlb-settlement',
    subject: 'Your Laptop Banking investment is in settlement',
    preheader: 'Choose to settle or renew. If you do not choose, principal is paid out.',
    bodyHtml: html,
    bodyText: text,
  });
}

export function vlbRenewalNudge(input: {
  firstName?: string;
  chooseBy: string;
  investmentId?: string;
}): RenderedEmail {
  const deadline = formatDateAccra(input.chooseBy) || input.chooseBy;
  const headingText = `Choose to settle or renew by ${deadline}`;
  const href = investmentsUrl(input.investmentId);
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`Choose to settle or renew by ${deadline}. If you do not choose, your principal will be paid out.`),
    button('Choose settle or renew', href),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`Choose to settle or renew by ${deadline}. If you do not choose, your principal will be paid out.`),
    textButton('Choose settle or renew', href),
  ]);
  return renderEmail({
    id: 'vlb-renewal-nudge',
    subject: `Choose to settle or renew by ${deadline}`,
    preheader: `If you do not choose by ${deadline}, your principal will be paid out.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function vlbRenewalChoiceAdmin(input: {
  investorNo: string;
  name: string;
  investmentId: string;
  choice: string;
}): RenderedEmail {
  const headingText = 'Laptop Banking renewal choice';
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph(`${input.name} chose to ${enumLabel(input.choice).toLowerCase()}.`),
    detailsTable([
      { label: 'Investor', value: input.investorNo },
      { label: 'Name', value: input.name },
      { label: 'Investment', value: input.investmentId },
      { label: 'Choice', value: enumLabel(input.choice) },
    ]),
    button('Open investments', investmentsUrl().replace('/account/investments', '/admin/vlb')),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textDetails([
      { label: 'Investor', value: input.investorNo },
      { label: 'Name', value: input.name },
      { label: 'Investment', value: input.investmentId },
      { label: 'Choice', value: enumLabel(input.choice) },
    ]),
  ]);
  return renderEmail({
    id: 'vlb-renewal-choice-admin',
    subject: `Laptop Banking renewal: ${enumLabel(input.choice).toLowerCase()}`,
    preheader: `${input.name} chose to ${enumLabel(input.choice).toLowerCase()}.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function vlbUpgradeRequestAdmin(input: {
  investorNo: string;
  name: string;
  planName: string;
  message?: string | null;
}): RenderedEmail {
  const headingText = 'Laptop Banking upgrade request';
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph(`${input.name} requested an upgrade.`),
    detailsTable([
      { label: 'Investor', value: input.investorNo },
      { label: 'Name', value: input.name },
      { label: 'Requested plan', value: input.planName },
    ]),
    input.message ? paragraph(input.message) : '',
    button('Open Laptop Banking', investmentsUrl().replace('/account/investments', '/admin/vlb')),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textDetails([
      { label: 'Investor', value: input.investorNo },
      { label: 'Name', value: input.name },
      { label: 'Requested plan', value: input.planName },
    ]),
    input.message || '',
  ]);
  return renderEmail({
    id: 'vlb-upgrade-request-admin',
    subject: 'Laptop Banking upgrade request',
    preheader: `${input.name} requested ${input.planName}.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function vlbPayoutDetailsChanged(input: { firstName?: string; byStaff?: boolean }): RenderedEmail {
  const headingText = input.byStaff
    ? 'Your payout details were updated by VENTECH'
    : 'Your payout details were changed';
  const body = input.byStaff
    ? 'Your payout details were updated by VENTECH. If you did not expect this change, contact support.'
    : 'Your Laptop Banking payout details were changed. If you did not make this change, contact support.';
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(body),
    button('View your investments', investmentsUrl()),
    secondaryLink('Contact support', contactUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(body),
    textButton('View your investments', investmentsUrl()),
  ]);
  return renderEmail({
    id: input.byStaff ? 'vlb-payout-details-staff' : 'vlb-payout-details-changed',
    subject: headingText,
    preheader: body,
    bodyHtml: html,
    bodyText: text,
  });
}

export function vlbAdminPayoutsDue(input: {
  today: string;
  rows: Array<{ investorNo: string; name: string; type: string; dueDate: string; amountPesewas: number }>;
}): RenderedEmail {
  const total = input.rows.reduce((sum, row) => sum + row.amountPesewas, 0);
  const headingText = 'Laptop Banking payouts due today';
  const items: EmailLineItem[] = input.rows.map((row) => ({
    name: `${row.investorNo} \u00B7 ${row.name} \u00B7 ${enumLabel(row.type)}`,
    quantity: 1,
    unitPrice: row.amountPesewas / 100,
    lineTotal: row.amountPesewas / 100,
  }));
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph(
      `${input.rows.length} payout${input.rows.length === 1 ? '' : 's'} due on ${formatDateAccra(input.today) || input.today}. Total net: ${formatMoneyPesewas(total)}.`
    ),
    lineItemsTable(items),
    totalsBlock([{ label: 'Total net', value: formatMoneyPesewas(total) }]),
    button('Open payouts', investmentsUrl().replace('/account/investments', '/admin/vlb')),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textLineItems(items),
    textTotals([{ label: 'Total net', value: formatMoneyPesewas(total) }]),
  ]);
  return renderEmail({
    id: 'vlb-admin-payouts-due',
    subject: `Laptop Banking: ${input.rows.length} payout${input.rows.length === 1 ? '' : 's'} due today`,
    preheader: `Total net ${formatMoneyPesewas(total)} due today.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function vlbAdminSettlement(input: {
  rows: Array<{ investorNo: string; name: string; principalPesewas: number }>;
}): RenderedEmail {
  const headingText = 'Laptop Banking investments entered settlement';
  const items: EmailLineItem[] = input.rows.map((row) => ({
    name: `${row.investorNo} \u00B7 ${row.name}`,
    quantity: 1,
    unitPrice: row.principalPesewas / 100,
    lineTotal: row.principalPesewas / 100,
  }));
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph('These investments entered the settlement month today.'),
    lineItemsTable(items),
    button('Open Laptop Banking', investmentsUrl().replace('/account/investments', '/admin/vlb')),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textLineItems(items),
  ]);
  return renderEmail({
    id: 'vlb-admin-settlement',
    subject: `Laptop Banking: ${input.rows.length} investment${input.rows.length === 1 ? '' : 's'} entered settlement`,
    preheader: `${input.rows.length} investment${input.rows.length === 1 ? '' : 's'} entered settlement today.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function vlbNewInvestmentAdmin(input: {
  fullName: string;
  email: string;
  phone: string;
  tier?: string;
  amount?: number;
  plan?: string;
  message?: string | null;
}): RenderedEmail {
  const headingText = 'New Laptop Banking application';
  const details = [
    { label: 'Name', value: input.fullName },
    { label: 'Email', value: input.email },
    { label: 'Phone', value: input.phone },
    { label: 'Tier', value: input.tier || '' },
    { label: 'Amount', value: input.amount != null ? formatMoneyGhs(input.amount) : '' },
    { label: 'Plan', value: input.plan || '' },
  ];
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph(`${input.fullName} submitted a Laptop Banking application.`),
    detailsTable(details),
    input.message ? paragraph(input.message) : '',
    button('Open Laptop Banking', investmentsUrl().replace('/account/investments', '/admin/vlb')),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textDetails(details),
    input.message || '',
  ]);
  return renderEmail({
    id: 'vlb-new-investment-admin',
    subject: `New Laptop Banking application: ${input.fullName}`,
    preheader: `${input.fullName} applied for Laptop Banking.`,
    bodyHtml: html,
    bodyText: text,
  });
}
