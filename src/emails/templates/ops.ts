import {
  button,
  detailsTable,
  heading,
  joinText,
  lineItemsTable,
  nextSteps,
  noticeBox,
  paragraph,
  secondaryLink,
  textButton,
  textDetails,
  textHeading,
  textLineItems,
  textNextSteps,
  textNotice,
  textParagraph,
  textSecondaryLink,
  textTotals,
  totalsBlock,
} from '../components';
import {
  absoluteUrl,
  accountUrl,
  contactUrl,
  enumLabel,
  formatDateAccra,
  formatMoneyGhs,
  greeting,
} from '../copy';
import { nl2br } from '../html';
import { renderEmail } from '../layout';
import type { EmailLineItem, RenderedEmail } from '../types';

export function staffInvite(input: { firstName?: string; inviteUrl: string }): RenderedEmail {
  const headingText = 'You are invited to the VENTECH team';
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph('Welcome. Set a password to join the VENTECH staff workspace.'),
    paragraph('This link expires. If it does, ask an admin to send a new invite.'),
    button('Set your password', input.inviteUrl),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph('Welcome. Set a password to join the VENTECH staff workspace.'),
    textButton('Set your password', input.inviteUrl),
  ]);
  return renderEmail({
    id: 'staff-invite',
    subject: 'You are invited to the VENTECH team',
    preheader: 'Set a password to join the VENTECH staff workspace.',
    bodyHtml: html,
    bodyText: text,
  });
}

export function contactAdmin(input: {
  name: string;
  email: string;
  phone?: string | null;
  subject: string;
  message: string;
}): RenderedEmail {
  const headingText = 'New contact form message';
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph(`${input.name} sent a message through the contact form.`),
    detailsTable([
      { label: 'Name', value: input.name },
      { label: 'Email', value: input.email },
      { label: 'Phone', value: input.phone || '' },
      { label: 'Subject', value: input.subject },
    ]),
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${nl2br(input.message)}</p>`,
    button(`Reply to ${input.name}`, `mailto:${input.email}`),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textDetails([
      { label: 'Name', value: input.name },
      { label: 'Email', value: input.email },
      { label: 'Phone', value: input.phone || '' },
      { label: 'Subject', value: input.subject },
    ]),
    input.message,
  ]);
  return renderEmail({
    id: 'contact-admin',
    subject: `Contact form: ${input.subject}`.slice(0, 58),
    preheader: `${input.name} wrote: ${input.subject}`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function contactCustomer(input: { firstName?: string; subject: string }): RenderedEmail {
  const headingText = 'We have your message';
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`We received your message about \u201c${input.subject}\u201d. A person from VENTECH will reply to this email address.`),
    nextSteps(['We read the message.', 'We reply from the support address in the footer.']),
    button('Visit VENTECH', contactUrl().replace(/\/contact$/, '')),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`We received your message about \u201c${input.subject}\u201d. A person from VENTECH will reply to this email address.`),
  ]);
  return renderEmail({
    id: 'contact-customer',
    subject: 'We have your message',
    preheader: `We received your message about \u201c${input.subject}\u201d.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function bulkOrderAdmin(input: {
  name: string;
  phone: string;
  email: string;
  organization?: string | null;
  productType: string;
  quantity: number | string;
  preferredSpecs?: string | null;
  deliveryLocation: string;
  paymentMethod: string;
  preferredDeliveryDate?: string | null;
  notes?: string | null;
}): RenderedEmail {
  const headingText = 'New bulk order request';
  const details = [
    { label: 'Name', value: input.name },
    { label: 'Phone', value: input.phone },
    { label: 'Email', value: input.email },
    { label: 'Organisation', value: input.organization || '' },
    { label: 'Product', value: input.productType },
    { label: 'Quantity', value: String(input.quantity) },
    { label: 'Delivery', value: input.deliveryLocation },
    { label: 'Payment', value: enumLabel(input.paymentMethod) || input.paymentMethod },
    { label: 'Preferred date', value: formatDateAccra(input.preferredDeliveryDate) },
  ];
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph(`${input.name} requested a bulk order.`),
    detailsTable(details),
    input.preferredSpecs ? noticeBox('info', 'Preferred specs', input.preferredSpecs) : '',
    input.notes ? noticeBox('info', 'Notes', input.notes) : '',
    nextSteps(['Contact the customer to confirm the order.', 'Send pricing before you take payment.']),
    button(`Reply to ${input.name}`, `mailto:${input.email}`),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textDetails(details),
    input.preferredSpecs ? textNotice('Preferred specs', input.preferredSpecs) : '',
    input.notes ? textNotice('Notes', input.notes) : '',
  ]);
  return renderEmail({
    id: 'bulk-order-admin',
    subject: `Bulk order: ${input.productType} (${input.quantity})`,
    preheader: `${input.name} requested ${input.quantity} \u00d7 ${input.productType}.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function bulkOrderCustomer(input: {
  firstName?: string;
  productType: string;
  quantity: number | string;
}): RenderedEmail {
  const headingText = 'We have your bulk order request';
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`We received your request for ${input.quantity} \u00d7 ${input.productType}. A person from VENTECH will contact you with pricing.`),
    nextSteps(['We review the request.', 'We call or email with availability and price.']),
    button('Contact VENTECH', contactUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`We received your request for ${input.quantity} \u00d7 ${input.productType}. A person from VENTECH will contact you with pricing.`),
  ]);
  return renderEmail({
    id: 'bulk-order-customer',
    subject: 'We have your bulk order request',
    preheader: `Your request for ${input.quantity} \u00d7 ${input.productType} is in.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function adminDigest(input: {
  commissionsReady: number;
  openWithdrawals: number;
  applicationsPending: number;
  staleServiceRequests: number;
  vlbPayoutsDueWeek: number;
  vlbInSettlement: number;
  vlbNewApplications: number;
  awaitingSerialCount: number;
  oldestOrders?: string[];
}): RenderedEmail {
  const headingText = 'Daily operations summary';
  const details = [
    { label: 'Commissions ready to verify', value: String(input.commissionsReady) },
    { label: 'Open withdrawals', value: String(input.openWithdrawals) },
    { label: 'Affiliate applications pending', value: String(input.applicationsPending) },
    { label: 'Service requests older than 7 days', value: String(input.staleServiceRequests) },
    { label: 'Laptop Banking payouts due this week', value: String(input.vlbPayoutsDueWeek) },
    { label: 'Investments in settlement', value: String(input.vlbInSettlement) },
    { label: 'New Laptop Banking applications', value: String(input.vlbNewApplications) },
    {
      label: 'Laptops awaiting serial over 2 days',
      value: input.oldestOrders?.length
        ? `${input.awaitingSerialCount} (oldest: ${input.oldestOrders.join(', ')})`
        : String(input.awaitingSerialCount),
    },
  ];
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph('Items that need attention today.'),
    detailsTable(details),
    button('Open admin', absoluteUrl('/admin')),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textDetails(details),
    textButton('Open admin', absoluteUrl('/admin')),
  ]);
  return renderEmail({
    id: 'admin-digest',
    subject: 'Daily operations summary',
    preheader: 'Items that need attention today.',
    bodyHtml: html,
    bodyText: text,
  });
}

export function outOfStock(input: { name: string; productId?: string }): RenderedEmail {
  const headingText = `${input.name} is out of stock`;
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph('This product has no remaining stock.'),
    detailsTable([
      { label: 'Product', value: input.name },
      { label: 'Product id', value: input.productId || '' },
    ]),
    button('Open products', absoluteUrl('/admin/products')),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textParagraph('This product has no remaining stock.'),
    textDetails([
      { label: 'Product', value: input.name },
      { label: 'Product id', value: input.productId || '' },
    ]),
  ]);
  return renderEmail({
    id: 'out-of-stock',
    subject: `Out of stock: ${input.name}`.slice(0, 58),
    preheader: `${input.name} has no remaining stock.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function wishlistReminder(input: {
  firstName?: string;
  items: Array<{ name: string; price?: number }>;
}): RenderedEmail {
  const headingText = 'Items on your wishlist are still available';
  const lineItems: EmailLineItem[] = input.items.map((item) => ({
    name: item.name,
    quantity: 1,
    unitPrice: item.price || 0,
    lineTotal: item.price || 0,
  }));
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph('These items are still on your wishlist.'),
    lineItemsTable(lineItems),
    button('Open your wishlist', absoluteUrl('/account/wishlist')),
    secondaryLink('Manage email preferences', accountUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textLineItems(lineItems),
    textButton('Open your wishlist', absoluteUrl('/account/wishlist')),
  ]);
  return renderEmail({
    id: 'wishlist-reminder',
    subject: 'Items on your wishlist are still available',
    preheader: 'These items are still on your wishlist.',
    bodyHtml: html,
    bodyText: text,
    marketing: true,
    unsubscribeUrl: accountUrl(),
  });
}

export function cartAbandonment(input: {
  firstName?: string;
  items: Array<{ name: string; quantity?: number; price?: number }>;
  total?: number;
}): RenderedEmail {
  const headingText = 'Your cart is still saved';
  const lineItems: EmailLineItem[] = input.items.map((item) => ({
    name: item.name,
    quantity: item.quantity || 1,
    unitPrice: item.price || 0,
    lineTotal: (item.price || 0) * (item.quantity || 1),
  }));
  const total =
    input.total != null
      ? input.total
      : lineItems.reduce((sum, item) => sum + (item.lineTotal || 0), 0);
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph('You left items in your cart. They are still saved on your account.'),
    lineItemsTable(lineItems),
    totalsBlock([{ label: 'Cart total', value: formatMoneyGhs(total) }]),
    button('Return to your cart', absoluteUrl('/cart')),
    secondaryLink('Manage email preferences', accountUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textLineItems(lineItems),
    textTotals([{ label: 'Cart total', value: formatMoneyGhs(total) }]),
    textButton('Return to your cart', absoluteUrl('/cart')),
  ]);
  return renderEmail({
    id: 'cart-abandonment',
    subject: 'Your cart is still saved',
    preheader: 'You left items in your cart. They are still saved.',
    bodyHtml: html,
    bodyText: text,
    marketing: true,
    unsubscribeUrl: accountUrl(),
  });
}

export function newsletter(input: {
  firstName?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
}): RenderedEmail {
  const headingText = input.subject;
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    input.htmlContent,
    secondaryLink('Manage email preferences', accountUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    input.textContent || input.subject,
    textSecondaryLink('Manage email preferences', accountUrl()),
  ]);
  return renderEmail({
    id: 'newsletter',
    subject: input.subject.slice(0, 58),
    preheader: input.subject,
    bodyHtml: html,
    bodyText: text,
    marketing: true,
    unsubscribeUrl: accountUrl(),
  });
}
