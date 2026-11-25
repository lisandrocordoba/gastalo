export function shortId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function formatCurrency(amount: number, currency = 'ARS'): string {
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(abs);
  const prefix = currency.toUpperCase() === 'USD' ? 'US$' : '$';
  const sign = amount < 0 ? '-' : '';
  return `${sign}${prefix} ${formatted}`;
}

export function todayInTimezone(tz = 'America/Argentina/Buenos_Aires'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export function currentMonthInTimezone(tz = 'America/Argentina/Buenos_Aires'): string {
  return todayInTimezone(tz).slice(0, 7);
}

export function getMonthDateRange(month: string): { start: string; end: string } {
  const [yStr, mStr] = month.split('-');
  const year = Number(yStr);
  const m = Number(mStr);
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function previousMonths(endMonth: string, count: number): string[] {
  const [yStr, mStr] = endMonth.split('-');
  const year = Number(yStr);
  const monthIdx = Number(mStr) - 1;
  const result: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, monthIdx - i, 1));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    result.push(`${y}-${m}`);
  }
  return result;
}
