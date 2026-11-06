import {
  button,
  detailsTable,
  heading,
  joinText,
  nextSteps,
  noticeBox,
  paragraph,
  secondaryLink,
  statusBadge,
  textButton,
  textDetails,
  textHeading,
  textNextSteps,
  textNotice,
  textParagraph,
  textSecondaryLink,
} from '../components';
import {
  affiliateUrl,
  contactUrl,
  enumLabel,
  formatMoneyPesewas,
  greeting,
} from '../copy';
import { nl2br } from '../html';
import { renderEmail } from '../layout';
import type { RenderedEmail } from '../types';

export function affiliateFeeReceived(input: { firstName?: string }): RenderedEmail {
  const headingText = 'Payment received, your application is under review';
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph('We received your affiliate application fee. Your application is under review.'),
    `<p style="margin:0 0 16px;">${statusBadge('Under review', 'info')}</p>`,
    nextSteps(['We review the application.', 'We email you when a decision is ready.']),
    button('Open affiliate account', affiliateUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph('We received your affiliate application fee. Your application is under review.'),
    textNextSteps(['We review the application.', 'We email you when a decision is ready.']),
    textButton('Open affiliate account', affiliateUrl()),
  ]);
  return renderEmail({
    id: 'affiliate-fee-received',
    subject: 'Payment received, application under review',
    preheader: 'Your affiliate application fee is in. We will email you a decision.',
    bodyHtml: html,
    bodyText: text,
  });
}

export function adminNewAffiliate(input: {
  name: string;
  email: string;
  affiliateId: string;
  status: string;
}): RenderedEmail {
  const headingText = 'New affiliate application';
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph('A new affiliate application is ready for review.'),
    detailsTable([
      { label: 'Name', value: input.name },
      { label: 'Email', value: input.email },
      { label: 'Affiliate id', value: input.affiliateId },
      { label: 'Status', value: enumLabel(input.status) },
    ]),
    button('Open affiliates', affiliateUrl().replace('/account/affiliate', '/admin/affiliates')),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textParagraph('A new affiliate application is ready for review.'),
    textDetails([
      { label: 'Name', value: input.name },
      { label: 'Email', value: input.email },
      { label: 'Affiliate id', value: input.affiliateId },
      { label: 'Status', value: enumLabel(input.status) },
    ]),
  ]);
  return renderEmail({
    id: 'admin-new-affiliate',
    subject: 'New affiliate application',
    preheader: `${input.name} applied to the affiliate programme.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function affiliateApproved(input: {
  firstName?: string;
  affiliateNo?: string | null;
  link?: string | null;
  commissionCopy?: string | null;
}): RenderedEmail {
  const headingText = 'Your affiliate account is active';
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(
      input.affiliateNo
        ? `Welcome to the VENTECH affiliate programme. Your code is ${input.affiliateNo}.`
        : 'Welcome to the VENTECH affiliate programme.'
    ),
    `<p style="margin:0 0 16px;">${statusBadge('Active', 'success')}</p>`,
    input.commissionCopy ? paragraph(input.commissionCopy) : '',
    input.link ? detailsTable([{ label: 'Share this link', value: input.link }]) : '',
    button('Open affiliate account', affiliateUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(
      input.affiliateNo
        ? `Welcome to the VENTECH affiliate programme. Your code is ${input.affiliateNo}.`
        : 'Welcome to the VENTECH affiliate programme.'
    ),
    input.commissionCopy || '',
    input.link ? `Share this link: ${input.link}` : '',
    textButton('Open affiliate account', affiliateUrl()),
  ]);
  return renderEmail({
    id: 'affiliate-approved',
    subject: 'Your affiliate account is active',
    preheader: input.affiliateNo
      ? `Your code is ${input.affiliateNo}. Start sharing your link.`
      : 'Your affiliate account is active. Start sharing your link.',
    bodyHtml: html,
    bodyText: text,
  });
}

export function affiliateRejected(input: { firstName?: string; reason: string }): RenderedEmail {
  const headingText = 'Your affiliate application was not approved';
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph('Your affiliate application was not approved.'),
    noticeBox('error', 'Decision', input.reason),
    button('Contact support', contactUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph('Your affiliate application was not approved.'),
    textNotice('Decision', input.reason),
    textButton('Contact support', contactUrl()),
  ]);
  return renderEmail({
    id: 'affiliate-rejected',
    subject: 'Your affiliate application was not approved',
    preheader: 'Your affiliate application was not approved.',
    bodyHtml: html,
    bodyText: text,
  });
}

export function affiliatePayoutChanged(input: { firstName?: string }): RenderedEmail {
  const headingText = 'Your payout details were changed';
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph('Your affiliate payout details were changed. Withdrawals are held for a short period after this change.'),
    paragraph('If you did not make this change, contact support.'),
    button('Open affiliate account', affiliateUrl()),
    secondaryLink('Contact support', contactUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph('Your affiliate payout details were changed. Withdrawals are held for a short period after this change.'),
    textParagraph('If you did not make this change, contact support.'),
    textButton('Open affiliate account', affiliateUrl()),
  ]);
  return renderEmail({
    id: 'affiliate-payout-changed',
    subject: 'Your payout details were changed',
    preheader: 'Affiliate payout details changed. Withdrawals are held for a short period.',
    bodyHtml: html,
    bodyText: text,
  });
}

export function affiliateWithdrawalRequested(input: {
  firstName?: string;
  amountPesewas: number;
}): RenderedEmail {
  const amount = formatMoneyPesewas(input.amountPesewas);
  const headingText = `Your withdrawal of ${amount} was requested`;
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`We received your withdrawal request for ${amount}.`),
    nextSteps(['We review the request.', 'We email you when it is paid or if we need anything.']),
    button('Open affiliate account', affiliateUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`We received your withdrawal request for ${amount}.`),
    textButton('Open affiliate account', affiliateUrl()),
  ]);
  return renderEmail({
    id: 'affiliate-withdrawal-requested',
    subject: `Withdrawal requested: ${amount}`,
    preheader: `We received your withdrawal request for ${amount}.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function adminAffiliateWithdrawal(input: {
  affiliateNo: string;
  amountPesewas: number;
}): RenderedEmail {
  const amount = formatMoneyPesewas(input.amountPesewas);
  const headingText = 'Affiliate withdrawal requested';
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph(`An affiliate requested a withdrawal of ${amount}.`),
    detailsTable([
      { label: 'Affiliate', value: input.affiliateNo },
      { label: 'Amount', value: amount },
    ]),
    button('Open affiliates', affiliateUrl().replace('/account/affiliate', '/admin/affiliates')),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textParagraph(`An affiliate requested a withdrawal of ${amount}.`),
    textDetails([
      { label: 'Affiliate', value: input.affiliateNo },
      { label: 'Amount', value: amount },
    ]),
  ]);
  return renderEmail({
    id: 'admin-affiliate-withdrawal',
    subject: `Affiliate withdrawal: ${amount}`,
    preheader: `${input.affiliateNo} requested ${amount}.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function affiliateWithdrawalStatus(input: {
  firstName?: string;
  amountPesewas: number;
  status: string;
  reason?: string | null;
}): RenderedEmail {
  const amount = formatMoneyPesewas(input.amountPesewas);
  const label = enumLabel(input.status).toLowerCase();
  const headingText = `Your withdrawal of ${amount} is ${label}`;
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`Your withdrawal of ${amount} is now ${label}.`),
    input.reason ? paragraph(input.reason) : '',
    button('Open affiliate account', affiliateUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`Your withdrawal of ${amount} is now ${label}.`),
    input.reason || '',
    textButton('Open affiliate account', affiliateUrl()),
  ]);
  return renderEmail({
    id: 'affiliate-withdrawal-status',
    subject: `Withdrawal ${label}: ${amount}`,
    preheader: `Your withdrawal of ${amount} is now ${label}.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function affiliateWithdrawalPaid(input: {
  firstName?: string;
  amountPesewas: number;
  reason?: string | null;
}): RenderedEmail {
  const amount = formatMoneyPesewas(input.amountPesewas);
  const headingText = `Your withdrawal of ${amount} was paid`;
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`Your withdrawal of ${amount} was paid.`),
    `<p style="margin:0 0 16px;">${statusBadge('Paid', 'success')}</p>`,
    input.reason ? paragraph(input.reason) : '',
    button('Open affiliate account', affiliateUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`Your withdrawal of ${amount} was paid.`),
    input.reason || '',
    textButton('Open affiliate account', affiliateUrl()),
  ]);
  return renderEmail({
    id: 'affiliate-withdrawal-paid',
    subject: `Withdrawal paid: ${amount}`,
    preheader: `Your withdrawal of ${amount} was paid.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function affiliateWithdrawalRejected(input: {
  firstName?: string;
  amountPesewas: number;
  reason?: string | null;
}): RenderedEmail {
  const amount = formatMoneyPesewas(input.amountPesewas);
  const headingText = `Your withdrawal of ${amount} was not paid`;
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`Your withdrawal of ${amount} was not paid. The amount is available again in your balance.`),
    input.reason ? noticeBox('error', 'Reason', input.reason) : '',
    button('Open affiliate account', affiliateUrl()),
    secondaryLink('Contact support', contactUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`Your withdrawal of ${amount} was not paid. The amount is available again in your balance.`),
    input.reason ? textNotice('Reason', input.reason) : '',
    textButton('Open affiliate account', affiliateUrl()),
  ]);
  return renderEmail({
    id: 'affiliate-withdrawal-rejected',
    subject: `Withdrawal not paid: ${amount}`,
    preheader: `Your withdrawal of ${amount} was not paid.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function affiliateCommissionPending(input: {
  firstName?: string;
  amountPesewas: number;
}): RenderedEmail {
  const amount = formatMoneyPesewas(input.amountPesewas);
  const headingText = `A commission of ${amount} is pending`;
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`A commission of ${amount} is pending on your affiliate account.`),
    paragraph('It becomes eligible after the order is delivered and the return window closes.'),
    button('Open affiliate account', affiliateUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`A commission of ${amount} is pending on your affiliate account.`),
    textParagraph('It becomes eligible after the order is delivered and the return window closes.'),
    textButton('Open affiliate account', affiliateUrl()),
  ]);
  return renderEmail({
    id: 'affiliate-commission-pending',
    subject: `Commission pending: ${amount}`,
    preheader: `A commission of ${amount} is pending on your account.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function affiliateCommissionReversed(input: {
  firstName?: string;
  amountPesewas: number;
  reason?: string | null;
}): RenderedEmail {
  const amount = formatMoneyPesewas(input.amountPesewas);
  const headingText = `A commission of ${amount} was reversed`;
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`A commission of ${amount} was reversed.`),
    input.reason ? noticeBox('warning', 'Reason', input.reason) : '',
    button('Open affiliate account', affiliateUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`A commission of ${amount} was reversed.`),
    input.reason || '',
    textButton('Open affiliate account', affiliateUrl()),
  ]);
  return renderEmail({
    id: 'affiliate-commission-reversed',
    subject: `Commission reversed: ${amount}`,
    preheader: `A commission of ${amount} was reversed.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function affiliateApplicationAdmin(input: {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  promotionChannel: string;
  platformLink: string;
  audienceSize?: string | null;
  payoutMethod?: string | null;
  reason?: string | null;
}): RenderedEmail {
  const headingText = 'New affiliate application';
  const details = [
    { label: 'Name', value: input.fullName },
    { label: 'Email', value: input.email },
    { label: 'Phone', value: input.phone },
    { label: 'Country', value: input.country },
    { label: 'Channel', value: input.promotionChannel },
    { label: 'Platform', value: input.platformLink },
    { label: 'Audience', value: input.audienceSize || '' },
    { label: 'Payout', value: enumLabel(input.payoutMethod || '') },
  ];
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph(`${input.fullName} submitted an affiliate application.`),
    detailsTable(details),
    input.reason ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${nl2br(input.reason)}</p>` : '',
    button('Open affiliates', affiliateUrl().replace('/account/affiliate', '/admin/affiliates')),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textDetails(details),
    input.reason || '',
  ]);
  return renderEmail({
    id: 'affiliate-application-admin',
    subject: `Affiliate application: ${input.fullName}`,
    preheader: `${input.fullName} applied via ${input.promotionChannel}.`,
    bodyHtml: html,
    bodyText: text,
  });
}
