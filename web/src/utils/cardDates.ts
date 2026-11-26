function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastDayOfMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function fallbackNextMonth(): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return addMonths(ym, 1);
}

/**
 * Computes the default statement month (YYYY-MM) for a credit card purchase
 * given its occurred date (YYYY-MM-DD) and optional card closing day (1..31).
 */
export function defaultCardStatementMonth(
  occurredAt: string,
  closingDay?: number | null
): string {
  const trimmed = occurredAt.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return fallbackNextMonth();
  }

  const ym = trimmed.slice(0, 7);
  const [, monthStr, dayStr] = trimmed.split('-');
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31
  ) {
    return fallbackNextMonth();
  }

  if (!closingDay || !Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) {
    return addMonths(ym, 1);
  }

  const effectiveClosingDay = Math.min(closingDay, lastDayOfMonth(ym));
  return day <= effectiveClosingDay ? addMonths(ym, 1) : addMonths(ym, 2);
}
