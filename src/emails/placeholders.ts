export class EmailPlaceholderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailPlaceholderError';
  }
}

const PLACEHOLDER = /\{\{|\}\}/;

export function leftoverPlaceholders(value: string): string[] {
  const matches = value.match(/\{\{[^}]*\}\}|\{\{|\}\}/g);
  return matches ? [...new Set(matches)] : [];
}

export function sanitizeEmailOutput(value: string, kind: 'html' | 'text' = 'html'): string {
  if (!PLACEHOLDER.test(value)) return value;
  const leftovers = leftoverPlaceholders(value);
  if (process.env.NODE_ENV === 'test') {
    throw new EmailPlaceholderError(
      `Email ${kind} still contains placeholders: ${leftovers.join(', ')}`
    );
  }
  console.error('[email-placeholder]', { kind, leftovers });
  return value.replace(/\{\{[^}]*\}\}/g, '').replace(/\{\{|\}\}/g, '');
}

export function assertNoPlaceholders(value: string, label = 'email'): void {
  if (!PLACEHOLDER.test(value)) return;
  throw new EmailPlaceholderError(
    `${label} still contains placeholders: ${leftoverPlaceholders(value).join(', ')}`
  );
}
