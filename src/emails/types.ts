export type EmailContact = {
  email: string;
  phone: string;
  siteUrl: string;
};

export type EmailLineItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal?: number;
};

export type EmailDetailRow = {
  label: string;
  value: string;
};

export type EmailNoticeTone = 'success' | 'warning' | 'error' | 'info';

export type EmailBadgeTone = EmailNoticeTone;

export type RenderedEmail = {
  id: string;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  bodyHtml?: string;
  bodyText?: string;
  unsubscribeUrl?: string | null;
  marketing?: boolean;
};

export type LayoutInput = {
  preheader: string;
  bodyHtml: string;
  bodyText: string;
  contact?: Partial<EmailContact>;
  unsubscribeUrl?: string | null;
  marketing?: boolean;
};
