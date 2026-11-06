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
  statusBadge,
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
  contactUrl,
  enumLabel,
  formatDateAccra,
  formatMoneyGhs,
  greeting,
  orderUrl,
  trackOrderUrl,
} from '../copy';
import {
  deliveryRows,
  isPreOrder,
  moneyRows,
  orderItems,
  orderNumberOf,
  orderStatusHeading,
  orderStatusNextSteps,
  orderStatusSubject,
  paymentMethodLabel,
  preOrderDetailRows,
  statusTone,
  type OrderEmailInput,
} from '../fromOrder';
import { renderEmail } from '../layout';
import type { RenderedEmail } from '../types';

function greetLine(order: OrderEmailInput): string {
  return greeting(order.customer_name);
}

export function orderConfirmation(order: OrderEmailInput): RenderedEmail {
  const number = orderNumberOf(order);
  const pre = isPreOrder(order);
  const items = orderItems(order);
  const money = moneyRows(order);
  const delivery = deliveryRows(order);
  const extra = preOrderDetailRows(order);
  const headingText = pre ? `Your pre-order ${number} is confirmed` : `Your order ${number} is confirmed`;
  const subject = pre ? `Pre-order ${number} confirmed` : `Order ${number} confirmed`;
  const badge = statusBadge(pre ? 'Pre-order' : 'Order confirmed', pre ? 'info' : 'success');
  const next = pre
    ? [
        'We source the item against this order.',
        extra.find((row) => row.label === 'Shipping method')
          ? `It ships by ${extra.find((row) => row.label === 'Shipping method')?.value?.toLowerCase()}.`
          : 'It ships using the method on this order.',
        extra.find((row) => row.label === 'Estimated arrival')
          ? `Estimated arrival is ${extra.find((row) => row.label === 'Estimated arrival')?.value}.`
          : 'We will update you when a delivery date is set.',
      ]
    : [
        'We prepare your order.',
        'We send it using your chosen delivery method.',
        'You can follow it from your account.',
      ];
  const details = [
    { label: 'Order', value: number },
    { label: 'Date', value: formatDateAccra(order.created_at) },
    { label: 'Payment', value: paymentMethodLabel(order) },
    { label: 'Payment status', value: enumLabel(order.payment_status || 'paid') },
    ...extra,
    ...delivery,
  ];
  const html = [
    heading(headingText),
    paragraph(greetLine(order)),
    paragraph(`This is a record of what you ordered on ${formatDateAccra(order.created_at) || 'this date'}.`),
    `<p style="margin:0 0 16px;">${badge}</p>`,
    lineItemsTable(items),
    totalsBlock(money),
    detailsTable(details),
    nextSteps(next),
    button(`View order ${number}`, orderUrl(number)),
    secondaryLink('Track this order', trackOrderUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greetLine(order)),
    textParagraph(`This is a record of what you ordered on ${formatDateAccra(order.created_at) || 'this date'}.`),
    pre ? 'Pre-order' : 'Order confirmed',
    textLineItems(items),
    textTotals(money),
    textDetails(details),
    textNextSteps(next),
    textButton(`View order ${number}`, orderUrl(number)),
    textSecondaryLink('Track this order', trackOrderUrl()),
  ]);
  return renderEmail({
    id: pre ? 'order-confirmation-preorder' : 'order-confirmation',
    subject,
    preheader: pre
      ? `Pre-order ${number} is in. We will source the item and update you.`
      : `Order ${number} is in. We are preparing it for delivery.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function adminNewOrder(order: OrderEmailInput): RenderedEmail {
  const number = orderNumberOf(order);
  const pre = isPreOrder(order);
  const items = orderItems(order);
  const headingText = pre ? `New pre-order ${number}` : `New order ${number}`;
  const details = [
    { label: 'Customer', value: order.customer_name || '' },
    { label: 'Email', value: order.customer_email || '' },
    { label: 'Date', value: formatDateAccra(order.created_at) },
    { label: 'Payment', value: paymentMethodLabel(order) },
    { label: 'Payment status', value: enumLabel(order.payment_status || 'paid') },
    ...preOrderDetailRows(order),
    ...deliveryRows(order),
  ];
  const href = orderUrl(number);
  const html = [
    heading(headingText),
    paragraph('Hi,'),
    paragraph(`${order.customer_name || 'A customer'} placed ${pre ? 'a pre-order' : 'an order'}.`),
    lineItemsTable(items),
    totalsBlock(moneyRows(order)),
    detailsTable(details),
    order.notes ? noticeBox('info', 'Order notes', order.notes) : '',
    button(`Open order ${number}`, href),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph('Hi,'),
    textParagraph(`${order.customer_name || 'A customer'} placed ${pre ? 'a pre-order' : 'an order'}.`),
    textLineItems(items),
    textTotals(moneyRows(order)),
    textDetails(details),
    order.notes ? textNotice('Order notes', order.notes) : '',
    textButton(`Open order ${number}`, href),
  ]);
  return renderEmail({
    id: pre ? 'admin-new-preorder' : 'admin-new-order',
    subject: pre ? `New pre-order ${number}` : `New order ${number}`,
    preheader: `${order.customer_name || 'Customer'} \u00B7 ${formatMoneyGhs(order.total)} \u00B7 ${items.length} item${items.length === 1 ? '' : 's'}`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function orderStatusUpdate(order: OrderEmailInput, newStatus: string): RenderedEmail {
  const number = orderNumberOf(order);
  const pre = isPreOrder(order);
  const headingText = orderStatusHeading(newStatus, pre);
  const subject = orderStatusSubject(number, newStatus, pre);
  const extra = preOrderDetailRows(order);
  const details = [
    { label: 'Order', value: number },
    { label: 'Status', value: enumLabel(newStatus) },
    ...extra,
  ];
  const next = orderStatusNextSteps(newStatus, pre);
  const html = [
    heading(headingText),
    paragraph(greetLine(order)),
    paragraph(`Here is the latest on ${number}.`),
    `<p style="margin:0 0 16px;">${statusBadge(enumLabel(newStatus), statusTone(newStatus))}</p>`,
    detailsTable(details),
    nextSteps(next),
    button(`View order ${number}`, orderUrl(number)),
    secondaryLink('Contact support', contactUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greetLine(order)),
    textParagraph(`Here is the latest on ${number}.`),
    enumLabel(newStatus),
    textDetails(details),
    textNextSteps(next),
    textButton(`View order ${number}`, orderUrl(number)),
    textSecondaryLink('Contact support', contactUrl()),
  ]);
  return renderEmail({
    id: `${pre ? 'order-status-preorder' : 'order-status'}-${String(newStatus || 'update').toLowerCase()}`,
    subject,
    preheader: `${number} is now ${enumLabel(newStatus).toLowerCase()}.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function orderCancelled(order: OrderEmailInput): RenderedEmail {
  const number = orderNumberOf(order);
  const headingText = `Your order ${number} has been cancelled`;
  const reason = order.cancellation_reason || '';
  const html = [
    heading(headingText),
    paragraph(greetLine(order)),
    paragraph(`Order ${number} has been cancelled.`),
    reason ? noticeBox('info', 'Reason', reason) : '',
    detailsTable([
      { label: 'Order', value: number },
      { label: 'Date', value: formatDateAccra(order.created_at) },
    ]),
    nextSteps([
      'If you paid online, any refund follows your original payment method.',
      'Place a new order whenever you are ready.',
    ]),
    button(`View order ${number}`, orderUrl(number)),
    secondaryLink('Contact support', contactUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greetLine(order)),
    textParagraph(`Order ${number} has been cancelled.`),
    reason ? textNotice('Reason', reason) : '',
    textNextSteps([
      'If you paid online, any refund follows your original payment method.',
      'Place a new order whenever you are ready.',
    ]),
    textButton(`View order ${number}`, orderUrl(number)),
  ]);
  return renderEmail({
    id: 'order-cancelled',
    subject: `Order ${number} has been cancelled`,
    preheader: `${number} was cancelled.${reason ? ` ${reason}` : ''}`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function orderPaymentProblem(order: OrderEmailInput): RenderedEmail {
  const number = orderNumberOf(order);
  const headingText = `We could not take payment for ${number}`;
  const html = [
    heading(headingText),
    paragraph(greetLine(order)),
    paragraph(`Payment for order ${number} did not go through. The order is not confirmed.`),
    noticeBox('error', 'Payment failed', 'No charge was completed. You can try again from checkout.'),
    detailsTable([
      { label: 'Order', value: number },
      { label: 'Amount', value: formatMoneyGhs(order.total) },
      { label: 'Method', value: paymentMethodLabel(order) },
    ]),
    nextSteps([
      'Open checkout and try the payment again.',
      'Use a different card or mobile money if the same method fails.',
    ]),
    button(`View order ${number}`, orderUrl(number)),
    secondaryLink('Contact support', contactUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greetLine(order)),
    textParagraph(`Payment for order ${number} did not go through. The order is not confirmed.`),
    textNotice('Payment failed', 'No charge was completed. You can try again from checkout.'),
    textButton(`View order ${number}`, orderUrl(number)),
  ]);
  return renderEmail({
    id: 'order-payment-problem',
    subject: `Payment failed for order ${number}`,
    preheader: `Payment for ${number} did not go through.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function orderDelivered(order: OrderEmailInput): RenderedEmail {
  return orderStatusUpdate({ ...order, status: 'delivered' }, 'delivered');
}
