const CEDIS = new Intl.NumberFormat('en-GH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCedis(amount: number | null | undefined): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 'GH₵0.00';
  return `GH₵${CEDIS.format(value)}`;
}

export function formatPesewas(pesewas: number | null | undefined): string {
  const value = Number(pesewas);
  if (!Number.isFinite(value)) return 'GH₵0.00';
  return formatCedis(value / 100);
}

// PDFKit Helvetica cannot draw ₵. Always ASCII "GHS" — never a locale currency glyph.
const GHS_ASCII = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

export function formatCedisPdf(amount: number | null | undefined): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 'GHS 0.00';
  const formatted = GHS_ASCII.format(Math.abs(value));
  return `${value < 0 ? '-' : ''}GHS ${formatted}`;
}

export function formatPesewasPdf(pesewas: number | null | undefined): string {
  const value = Number(pesewas);
  if (!Number.isFinite(value)) return 'GHS 0.00';
  return formatCedisPdf(value / 100);
}
