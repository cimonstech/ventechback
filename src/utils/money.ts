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
