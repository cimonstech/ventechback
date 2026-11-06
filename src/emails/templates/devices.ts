import {
  button,
  codeBlock,
  heading,
  joinText,
  nextSteps,
  paragraph,
  textButton,
  textHeading,
  textNextSteps,
  textParagraph,
} from '../components';
import { accountUrl, deviceUrl, greeting } from '../copy';
import { renderEmail } from '../layout';
import type { RenderedEmail } from '../types';

export function deviceRegistered(input: {
  firstName?: string;
  devices: Array<{ model_name: string; qr_token: string }>;
}): RenderedEmail {
  const first = input.devices[0];
  const headingText =
    input.devices.length > 1 ? 'Your VENTECH laptops are registered' : 'Your VENTECH laptop is registered';
  const href = first ? deviceUrl(first.qr_token) : accountUrl();
  const names = input.devices.map((device) => device.model_name).join(', ');
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(
      input.devices.length > 1
        ? 'These laptops are now registered with VENTECH.'
        : 'Your laptop is now registered with VENTECH.'
    ),
    paragraph(names),
    nextSteps(['Keep this email so you can open the laptop page later.', 'Use the claim code if you transfer ownership.']),
    button(first ? `View ${first.model_name}` : 'Open your account', href),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(names),
    textButton(first ? `View ${first.model_name}` : 'Open your account', href),
  ]);
  return renderEmail({
    id: 'device-registered',
    subject: input.devices.length > 1 ? 'Your VENTECH laptops are registered' : 'Your VENTECH laptop is registered',
    preheader: names || 'Your laptop is now registered with VENTECH.',
    bodyHtml: html,
    bodyText: text,
  });
}

export function deviceOwnerLinked(input: { firstName?: string; modelName: string; qrToken: string }): RenderedEmail {
  const headingText = 'A VENTECH laptop has been added to your account';
  const href = deviceUrl(input.qrToken);
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph(`${input.modelName} is now on your account.`),
    button(`View ${input.modelName}`, href),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph(`${input.modelName} is now on your account.`),
    textButton(`View ${input.modelName}`, href),
  ]);
  return renderEmail({
    id: 'device-owner-linked',
    subject: 'A VENTECH laptop was added to your account',
    preheader: `${input.modelName} is now on your account.`,
    bodyHtml: html,
    bodyText: text,
  });
}

export function deviceClaimCode(input: { firstName?: string; code: string }): RenderedEmail {
  const headingText = 'Your VENTECH laptop claim code';
  const html = [
    heading(headingText),
    paragraph(greeting(input.firstName)),
    paragraph('Use this code to add the laptop to your VENTECH account. It expires in 10 minutes.'),
    codeBlock(input.code),
    paragraph('If you did not request this, you can ignore this email.'),
    button('Open your account', accountUrl()),
  ].join('');
  const text = joinText([
    textHeading(headingText),
    textParagraph(greeting(input.firstName)),
    textParagraph('Use this code to add the laptop to your VENTECH account. It expires in 10 minutes.'),
    input.code,
    textParagraph('If you did not request this, you can ignore this email.'),
    textButton('Open your account', accountUrl()),
  ]);
  return renderEmail({
    id: 'device-claim-code',
    subject: 'Your VENTECH laptop claim code',
    preheader: 'This code expires in 10 minutes.',
    bodyHtml: html,
    bodyText: text,
  });
}
