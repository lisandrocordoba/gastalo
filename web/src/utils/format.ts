/**
 * Formats a numeric amount using Argentine locale grouping and the currency prefix.
 */
export function formatMoney(amount: number, currency = 'ARS'): string {
  const code = currency.toUpperCase();
  const prefix = code === 'USD' ? 'US$' : code === 'BRL' ? 'R$' : '$';
  if (!Number.isFinite(amount)) {
    return `${prefix} 0`;
  }
  const normalized = Math.abs(amount) < 0.005 ? 0 : amount;
  const abs = Math.abs(normalized);
  const formatted = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(abs);
  const sign = normalized < 0 ? '-' : '';
  return `${sign}${prefix} ${formatted}`;
}
