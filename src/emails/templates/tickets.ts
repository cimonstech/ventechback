import {
  button,
  detailsTable,
  heading,
  joinText,
  nextSteps,
  paragraph,
  secondaryLink,
  statusBadge,
  textButton,
  textDetails,
  textHeading,
  textNextSteps,
  textParagraph,
  textSecondaryLink,
} from '../components';
import {
  accountUrl,
  adminTicketUrl,
  contactUrl,
  enumLabel,
  formatDateTimeAccra,
  formatMoneyGhs,
  greeting,
  ticketUrl,
} from '../copy';
import { statusTone } from '../fromOrder';
import { nl2br } from '../html';
import { renderEmail } from '../layout';
import type { RenderedEmail } from '../types';

export function ticketReceived(input: { firstName?: string; ticketNo: string }): RenderedEmail {
  const headingText = `We have your service request ${input.ticketNo}`;
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`Your request ${input.ticketNo} is with the service desk.`),
    `<p style="margin:0 0 16px;">${statusBadge('Submitted', 'info')}</p>`,
    nextSteps([
      'A technician reviews the request.',
      'We email you when the status changes.',
    ]),
    button(`View request ${input.ticketNo}`, ticketUrl(input.ticketNo)),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`Your request ${input.ticketNo} is with the service desk.`),
    textNextSteps(['A technician reviews the request.', 'We email you when the status changes.']),
    textButton(`View request ${input.ticketNo}`, ticketUrl(input.ticketNo)),
  ]);
  return renderEmail({
    id: 'ticket-received',
    subject: `We have your request ${input.ticketNo}`,
    preheader: `${input.ticketNo} is with the service desk.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function adminNewTicket(input: {
  ticketId: string;
  ticketNo: string;
  issue: string;
  model: string;
}): RenderedEmail {
  const headingText = `New service request ${input.ticketNo}`;
  const href = adminTicketUrl(input.ticketId) || accountUrl();
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph(`${input.issue} on ${input.model}.`),
    detailsTable([
      { label: 'Ticket', value: input.ticketNo },
      { label: 'Issue', value: input.issue },
      { label: 'Laptop', value: input.model },
    ]),
    button(`Open ticket ${input.ticketNo}`, href),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textParagraph(`${input.issue} on ${input.model}.`),
    textDetails([
      { label: 'Ticket', value: input.ticketNo },
      { label: 'Issue', value: input.issue },
      { label: 'Laptop', value: input.model },
    ]),
    textButton(`Open ticket ${input.ticketNo}`, href),
  ]);
  return renderEmail({
    id: 'admin-new-ticket',
    subject: `New request ${input.ticketNo}: ${input.issue}`,
    preheader: `${input.issue} on ${input.model}.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function ticketStatus(input: {
  firstName?: string;
  ticketNo: string;
  status: string;
  note?: string | null;
}): RenderedEmail {
  const label = enumLabel(input.status);
  const headingText = `Your request ${input.ticketNo} is ${label.toLowerCase()}`;
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`The status of ${input.ticketNo} is now ${label.toLowerCase()}.`),
    `<p style="margin:0 0 16px;">${statusBadge(label, statusTone(input.status))}</p>`,
    input.note ? paragraph(input.note) : '',
    button(`View request ${input.ticketNo}`, ticketUrl(input.ticketNo)),
    secondaryLink('Contact support', contactUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`The status of ${input.ticketNo} is now ${label.toLowerCase()}.`),
    input.note || '',
    textButton(`View request ${input.ticketNo}`, ticketUrl(input.ticketNo)),
  ]);
  return renderEmail({
    id: 'ticket-status',
    subject: `${input.ticketNo} is now ${label.toLowerCase()}`,
    preheader: `Your request ${input.ticketNo} is ${label.toLowerCase()}.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function ticketReady(input: { firstName?: string; ticketNo: string; note?: string | null }): RenderedEmail {
  const headingText = `Your laptop is ready \u2014 ${input.ticketNo}`;
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`Request ${input.ticketNo} is ready for collection.`),
    `<p style="margin:0 0 16px;">${statusBadge('Ready', 'success')}</p>`,
    input.note ? paragraph(input.note) : '',
    nextSteps([
      'Bring a matching ID when you collect the laptop.',
      'Ask at the counter if you need a receipt.',
    ]),
    button(`View request ${input.ticketNo}`, ticketUrl(input.ticketNo)),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`Request ${input.ticketNo} is ready for collection.`),
    input.note || '',
    textNextSteps([
      'Bring a matching ID when you collect the laptop.',
      'Ask at the counter if you need a receipt.',
    ]),
    textButton(`View request ${input.ticketNo}`, ticketUrl(input.ticketNo)),
  ]);
  return renderEmail({
    id: 'ticket-ready',
    subject: `Your laptop is ready: ${input.ticketNo}`,
    preheader: `${input.ticketNo} is ready for collection.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function ticketStaffReply(input: { firstName?: string; ticketNo: string; body: string }): RenderedEmail {
  const headingText = `New reply on ${input.ticketNo}`;
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`There is a new message on your request ${input.ticketNo}.`),
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${nl2br(input.body)}</p>`,
    button(`View request ${input.ticketNo}`, ticketUrl(input.ticketNo)),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`There is a new message on your request ${input.ticketNo}.`),
    input.body,
    textButton(`View request ${input.ticketNo}`, ticketUrl(input.ticketNo)),
  ]);
  return renderEmail({
    id: 'ticket-staff-reply',
    subject: `New reply on ${input.ticketNo}`,
    preheader: `A reply was added to ${input.ticketNo}.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function ticketReceipt(input: {
  firstName?: string;
  ticketNo: string;
  laptop: string;
  amount: number;
  method: string;
  reference?: string | null;
  paidAt: string;
}): RenderedEmail {
  const headingText = `Payment received for ${input.ticketNo}`;
  const details = [
    { label: 'Ticket', value: input.ticketNo },
    { label: 'Laptop', value: input.laptop },
    { label: 'Amount', value: formatMoneyGhs(input.amount) },
    { label: 'Method', value: enumLabel(input.method) },
    { label: 'Reference', value: input.reference || '' },
    { label: 'Paid', value: formatDateTimeAccra(input.paidAt) },
  ];
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`We recorded your payment of ${formatMoneyGhs(input.amount)} for ${input.ticketNo}.`),
    detailsTable(details),
    button(`View request ${input.ticketNo}`, ticketUrl(input.ticketNo)),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`We recorded your payment of ${formatMoneyGhs(input.amount)} for ${input.ticketNo}.`),
    textDetails(details),
    textButton(`View request ${input.ticketNo}`, ticketUrl(input.ticketNo)),
  ]);
  return renderEmail({
    id: 'ticket-receipt',
    subject: `Payment received for ${input.ticketNo}`,
    preheader: `${formatMoneyGhs(input.amount)} recorded for ${input.ticketNo}.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function adminTicketMessage(input: { ticketId: string; ticketNo: string; body: string }): RenderedEmail {
  const headingText = `New customer message on ${input.ticketNo}`;
  const href = adminTicketUrl(input.ticketId) || accountUrl();
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph(`A customer wrote on ${input.ticketNo}.`),
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${nl2br(input.body)}</p>`,
    button(`Open ticket ${input.ticketNo}`, href),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    input.body,
    textButton(`Open ticket ${input.ticketNo}`, href),
  ]);
  return renderEmail({
    id: 'admin-ticket-message',
    subject: `New message on ${input.ticketNo}`,
    preheader: `A customer wrote on ${input.ticketNo}.`,
    bodyHtml: html,
    bodyText: text,
  });
}
