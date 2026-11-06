export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/\n/g, ' ');
}

export function nl2br(value: string): string {
  return escapeHtml(value).replace(/\r\n|\n|\r/g, '<br>');
}
