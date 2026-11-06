import { formatMoneyGhs } from './copy';
import { escapeAttr, escapeHtml } from './html';
import type { EmailBadgeTone, EmailDetailRow, EmailLineItem, EmailNoticeTone } from './types';

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const EMAIL_COLOURS = {
  text: '#1A1A1A',
  secondary: '#525252',
  border: '#E7E5E4',
  /** Body text links stay terracotta. */
  button: '#C2410C',
  /** Primary CTA button fill (black). */
  buttonBg: '#1A1A1A',
  buttonText: '#FFFFFF',
  page: '#F5F5F4',
  card: '#FFFFFF',
  stripe: '#FF7A19',
  successFg: '#166534',
  successBg: '#F0FDF4',
  warningFg: '#92400E',
  warningBg: '#FFFBEB',
  errorFg: '#991B1B',
  errorBg: '#FEF2F2',
  infoFg: '#1E40AF',
  infoBg: '#EFF6FF',
};

const TONE: Record<EmailNoticeTone, { fg: string; bg: string }> = {
  success: { fg: EMAIL_COLOURS.successFg, bg: EMAIL_COLOURS.successBg },
  warning: { fg: EMAIL_COLOURS.warningFg, bg: EMAIL_COLOURS.warningBg },
  error: { fg: EMAIL_COLOURS.errorFg, bg: EMAIL_COLOURS.errorBg },
  info: { fg: EMAIL_COLOURS.infoFg, bg: EMAIL_COLOURS.infoBg },
};

export function heading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;color:${EMAIL_COLOURS.text};">${escapeHtml(text)}</h1>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.5;color:${EMAIL_COLOURS.text};">${escapeHtml(text)}</p>`;
}

export function richParagraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.5;color:${EMAIL_COLOURS.text};">${html}</p>`;
}

export function secondaryText(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:1.5;color:${EMAIL_COLOURS.secondary};">${escapeHtml(text)}</p>`;
}

export function button(label: string, href: string): string {
  const safeHref = escapeAttr(href);
  const safeLabel = escapeHtml(label);
  // Bulletproof button: padded table cell + VML for Outlook; left-aligned with content.
  return `<!--[if mso]>
  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:44px;v-text-anchor:middle;width:280px;" arcsize="14%" stroke="f" fillcolor="${EMAIL_COLOURS.buttonBg}">
    <w:anchorlock/>
    <center style="color:${EMAIL_COLOURS.buttonText};font-family:Segoe UI,sans-serif;font-size:16px;font-weight:700;">${safeLabel}</center>
  </v:roundrect>
  <![endif]-->
  <!--[if !mso]><!-- -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="email-btn" style="margin:8px 0 24px;border-collapse:separate;">
  <tr>
    <td align="left" bgcolor="${EMAIL_COLOURS.buttonBg}" style="background-color:${EMAIL_COLOURS.buttonBg};border-radius:6px;mso-padding-alt:14px 24px;">
      <a href="${safeHref}" style="display:inline-block;box-sizing:border-box;min-height:44px;padding:14px 24px;font-family:${FONT};font-size:16px;line-height:16px;font-weight:700;color:${EMAIL_COLOURS.buttonText};text-decoration:none;white-space:nowrap;vertical-align:middle;">${safeLabel}</a>
    </td>
  </tr>
</table>
  <!--<![endif]-->`;
}

export function secondaryLink(label: string, href: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:1.5;"><a href="${escapeAttr(href)}" style="color:${EMAIL_COLOURS.button};text-decoration:underline;">${escapeHtml(label)}</a></p>`;
}

export function detailsTable(rows: EmailDetailRow[]): string {
  const body = rows
    .filter((row) => row.value)
    .map(
      (row) => `<tr>
      <td style="padding:8px 12px 8px 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${EMAIL_COLOURS.secondary};width:40%;vertical-align:top;">${escapeHtml(row.label)}</td>
      <td style="padding:8px 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${EMAIL_COLOURS.text};vertical-align:top;">${escapeHtml(row.value)}</td>
    </tr>`
    )
    .join('');
  if (!body) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">${body}</table>`;
}

export function lineItemsTable(items: EmailLineItem[]): string {
  const header = `<tr>
    <th align="left" style="padding:8px 8px 8px 0;font-family:${FONT};font-size:13px;line-height:1.4;font-weight:700;color:${EMAIL_COLOURS.secondary};border-bottom:1px solid ${EMAIL_COLOURS.border};">Item</th>
    <th align="right" style="padding:8px;font-family:${FONT};font-size:13px;line-height:1.4;font-weight:700;color:${EMAIL_COLOURS.secondary};border-bottom:1px solid ${EMAIL_COLOURS.border};width:48px;">Qty</th>
    <th align="right" style="padding:8px 0 8px 8px;font-family:${FONT};font-size:13px;line-height:1.4;font-weight:700;color:${EMAIL_COLOURS.secondary};border-bottom:1px solid ${EMAIL_COLOURS.border};width:110px;">Price</th>
  </tr>`;
  const rows = items
    .map((item) => {
      const total = item.lineTotal ?? item.unitPrice * item.quantity;
      return `<tr>
      <td style="padding:10px 8px 10px 0;font-family:${FONT};font-size:14px;line-height:1.4;color:${EMAIL_COLOURS.text};border-bottom:1px solid ${EMAIL_COLOURS.border};">${escapeHtml(item.name)}</td>
      <td align="right" style="padding:10px 8px;font-family:${FONT};font-size:14px;line-height:1.4;color:${EMAIL_COLOURS.text};border-bottom:1px solid ${EMAIL_COLOURS.border};font-variant-numeric:tabular-nums;">${escapeHtml(String(item.quantity))}</td>
      <td align="right" style="padding:10px 0 10px 8px;font-family:${FONT};font-size:14px;line-height:1.4;color:${EMAIL_COLOURS.text};border-bottom:1px solid ${EMAIL_COLOURS.border};font-variant-numeric:tabular-nums;white-space:nowrap;">${escapeHtml(formatMoneyGhs(total))}</td>
    </tr>`;
    })
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;border-collapse:collapse;">${header}${rows}</table>`;
}

export function totalsBlock(rows: EmailDetailRow[]): string {
  const body = rows
    .map((row, index) => {
      const last = index === rows.length - 1;
      const weight = last ? 700 : 400;
      const size = last ? 16 : 14;
      return `<tr>
      <td style="padding:6px 12px 6px 0;font-family:${FONT};font-size:${size}px;line-height:1.5;font-weight:${weight};color:${EMAIL_COLOURS.text};">${escapeHtml(row.label)}</td>
      <td align="right" style="padding:6px 0;font-family:${FONT};font-size:${size}px;line-height:1.5;font-weight:${weight};color:${EMAIL_COLOURS.text};font-variant-numeric:tabular-nums;white-space:nowrap;">${escapeHtml(row.value)}</td>
    </tr>`;
    })
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">${body}</table>`;
}

export function statusBadge(label: string, tone: EmailBadgeTone): string {
  const colours = TONE[tone];
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-family:${FONT};font-size:13px;line-height:1.4;font-weight:700;color:${colours.fg};background:${colours.bg};">${escapeHtml(label)}</span>`;
}

export function noticeBox(tone: EmailNoticeTone, title: string, body?: string): string {
  const colours = TONE[tone];
  const bodyHtml = body
    ? `<p style="margin:6px 0 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${colours.fg};">${escapeHtml(body)}</p>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
  <tr>
    <td style="padding:14px 16px;border-radius:8px;background:${colours.bg};">
      <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.5;font-weight:700;color:${colours.fg};">${escapeHtml(title)}</p>
      ${bodyHtml}
    </td>
  </tr>
</table>`;
}

export function divider(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 24px;"><tr><td style="border-top:1px solid ${EMAIL_COLOURS.border};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

export function nextSteps(items: string[]): string {
  const rows = items
    .map(
      (item, index) => `<tr>
      <td valign="top" style="padding:0 10px 8px 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${EMAIL_COLOURS.secondary};width:24px;">${index + 1}.</td>
      <td style="padding:0 0 8px;font-family:${FONT};font-size:14px;line-height:1.5;color:${EMAIL_COLOURS.text};">${escapeHtml(item)}</td>
    </tr>`
    )
    .join('');
  return `<p style="margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:1.5;font-weight:700;color:${EMAIL_COLOURS.text};">What happens next</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;">${rows}</table>`;
}

export function codeBlock(code: string): string {
  return `<p style="margin:8px 0 24px;font-family:${FONT};font-size:28px;line-height:1.3;font-weight:700;letter-spacing:4px;color:${EMAIL_COLOURS.text};">${escapeHtml(code)}</p>`;
}

export function textHeading(text: string): string {
  return text;
}

export function textParagraph(text: string): string {
  return text;
}

export function textButton(label: string, href: string): string {
  return `${label}\n${href}`;
}

export function textSecondaryLink(label: string, href: string): string {
  return `${label}: ${href}`;
}

export function textDetails(rows: EmailDetailRow[]): string {
  return rows
    .filter((row) => row.value)
    .map((row) => `${row.label}: ${row.value}`)
    .join('\n');
}

export function textLineItems(items: EmailLineItem[]): string {
  return items
    .map((item) => {
      const total = item.lineTotal ?? item.unitPrice * item.quantity;
      return `${item.name}  x${item.quantity}  ${formatMoneyGhs(total)}`;
    })
    .join('\n');
}

export function textTotals(rows: EmailDetailRow[]): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join('\n');
}

export function textNotice(title: string, body?: string): string {
  return body ? `${title}\n${body}` : title;
}

export function textNextSteps(items: string[]): string {
  return ['What happens next', ...items.map((item, index) => `${index + 1}. ${item}`)].join('\n');
}

export function joinText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n\n');
}
