import {
  button,
  EMAIL_COLOURS,
  heading,
  paragraph,
  secondaryLink,
} from './components';
import { fallbackContact, loadEmailContact } from './contact';
import { LOGO_URL, telHref } from './copy';
import { escapeAttr, escapeHtml } from './html';
import { sanitizeEmailOutput } from './placeholders';
import type { EmailContact, LayoutInput, RenderedEmail } from './types';

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function padPreheader(preheader: string): string {
  const pad = '\u00A0'.repeat(Math.max(0, 90 - preheader.length));
  return `${preheader}${pad}`;
}

function footerHtml(contact: EmailContact, marketing: boolean, unsubscribeUrl?: string | null): string {
  const phoneHref = telHref(contact.phone);
  const unsub = marketing
    ? `<p style="margin:12px 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${EMAIL_COLOURS.secondary};">If you no longer want these emails, turn off marketing emails in your account${
        unsubscribeUrl
          ? ` \u2014 <a href="${escapeAttr(unsubscribeUrl)}" style="color:${EMAIL_COLOURS.button};text-decoration:underline;">unsubscribe</a>`
          : '.'
      }</p>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px;border-top:1px solid ${EMAIL_COLOURS.border};">
  <tr>
    <td style="padding:20px 0 0;">
      <p style="margin:0 0 4px;font-family:${FONT};font-size:13px;line-height:1.5;color:${EMAIL_COLOURS.secondary};">VENTECH Gadgets</p>
      <p style="margin:0 0 4px;font-family:${FONT};font-size:13px;line-height:1.5;color:${EMAIL_COLOURS.secondary};">
        <a href="mailto:${escapeAttr(contact.email)}" style="color:${EMAIL_COLOURS.button};text-decoration:none;">${escapeHtml(contact.email)}</a>
        &nbsp;\u00B7&nbsp;
        <a href="${escapeAttr(phoneHref)}" style="color:${EMAIL_COLOURS.button};text-decoration:none;">${escapeHtml(contact.phone)}</a>
      </p>
      <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;">
        <a href="${escapeAttr(contact.siteUrl)}" style="color:${EMAIL_COLOURS.button};text-decoration:underline;">${escapeHtml(contact.siteUrl.replace(/^https?:\/\//, ''))}</a>
      </p>
      ${unsub}
    </td>
  </tr>
</table>`;
}

function footerText(contact: EmailContact, marketing: boolean, unsubscribeUrl?: string | null): string {
  const lines = [
    'VENTECH Gadgets',
    contact.email,
    contact.phone,
    contact.siteUrl,
  ];
  if (marketing) {
    lines.push(
      unsubscribeUrl
        ? `If you no longer want these emails, turn off marketing emails in your account: ${unsubscribeUrl}`
        : 'If you no longer want these emails, turn off marketing emails in your account.'
    );
  }
  return lines.join('\n');
}

export function layoutHtml(input: LayoutInput): string {
  const contact = fallbackContact(input.contact);
  const preheader = padPreheader(input.preheader);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title></title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-outer { padding: 16px 12px !important; }
      .email-pad { padding: 20px !important; }
    }
    @media only screen and (max-width: 480px) {
      .email-btn { width: 100% !important; }
      .email-btn td { width: 100% !important; }
      .email-btn a { display: block !important; width: 100% !important; text-align: center !important; white-space: normal !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLOURS.page};">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${EMAIL_COLOURS.page};">
    <tr>
      <td class="email-outer" align="center" style="padding:24px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:${EMAIL_COLOURS.card};border-radius:8px;overflow:hidden;">
          <tr>
            <td style="height:4px;line-height:4px;font-size:0;background-color:${EMAIL_COLOURS.stripe};">&nbsp;</td>
          </tr>
          <tr>
            <td class="email-pad" style="padding:32px;background-color:${EMAIL_COLOURS.card};">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;">
                <tr>
                  <td>
                    <img src="${escapeAttr(LOGO_URL)}" alt="VENTECH" height="32" style="display:block;height:32px;width:auto;border:0;">
                  </td>
                </tr>
              </table>
              ${input.bodyHtml}
              ${footerHtml(contact, Boolean(input.marketing), input.unsubscribeUrl)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function layoutText(input: LayoutInput): string {
  const contact = fallbackContact(input.contact);
  return [input.preheader, input.bodyText, footerText(contact, Boolean(input.marketing), input.unsubscribeUrl)]
    .filter(Boolean)
    .join('\n\n');
}

export function renderEmail(input: {
  id: string;
  subject: string;
  preheader: string;
  bodyHtml: string;
  bodyText: string;
  contact?: Partial<EmailContact>;
  unsubscribeUrl?: string | null;
  marketing?: boolean;
}): RenderedEmail {
  const layout = {
    preheader: input.preheader,
    bodyHtml: input.bodyHtml,
    bodyText: input.bodyText,
    contact: input.contact,
    unsubscribeUrl: input.unsubscribeUrl,
    marketing: input.marketing,
  };
  return {
    id: input.id,
    subject: input.subject,
    preheader: input.preheader,
    html: sanitizeEmailOutput(layoutHtml(layout), 'html'),
    text: sanitizeEmailOutput(layoutText(layout), 'text'),
    bodyHtml: input.bodyHtml,
    bodyText: input.bodyText,
    unsubscribeUrl: input.unsubscribeUrl,
    marketing: input.marketing,
  };
}

/** Re-wrap with store phone/email from settings before sending. */
export async function finalizeRenderedEmail(rendered: RenderedEmail): Promise<RenderedEmail> {
  if (!rendered.bodyHtml || !rendered.bodyText) return rendered;
  const contact = await loadEmailContact();
  return renderEmail({
    id: rendered.id,
    subject: rendered.subject,
    preheader: rendered.preheader,
    bodyHtml: rendered.bodyHtml,
    bodyText: rendered.bodyText,
    contact,
    unsubscribeUrl: rendered.unsubscribeUrl,
    marketing: rendered.marketing,
  });
}

export function simpleBody(opts: {
  heading: string;
  greeting?: string;
  paragraphs: string[];
  button?: { label: string; href: string };
  secondary?: { label: string; href: string };
  extraHtml?: string;
}): { html: string; text: string } {
  const html = [
    heading(opts.heading),
    opts.greeting ? paragraph(opts.greeting) : '',
    ...opts.paragraphs.map((p) => paragraph(p)),
    opts.extraHtml || '',
    opts.button ? button(opts.button.label, opts.button.href) : '',
    opts.secondary ? secondaryLink(opts.secondary.label, opts.secondary.href) : '',
  ].join('');
  const text = [
    opts.heading,
    opts.greeting,
    ...opts.paragraphs,
    opts.button ? `${opts.button.label}\n${opts.button.href}` : '',
    opts.secondary ? `${opts.secondary.label}: ${opts.secondary.href}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { html, text };
}
