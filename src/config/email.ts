const DEFAULT_ADMIN_NOTIFICATION_EMAIL = 'ventechgadgets@gmail.com';

export const adminNotificationEmail =
  process.env.ADMIN_NOTIFICATION_EMAIL?.trim() || DEFAULT_ADMIN_NOTIFICATION_EMAIL;

export const emailSubjectPrefix = process.env.EMAIL_SUBJECT_PREFIX ?? '';

export function emailSubject(subject: string): string {
  if (!emailSubjectPrefix) return subject;
  return `${emailSubjectPrefix}${subject}`;
}
