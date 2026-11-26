import { SUPPORTED_CURRENCIES, type AccountType, type SupportedCurrency } from './types';

export function isSupportedCurrency(c: string): c is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(c);
}

export function normalizeCurrency(
  c: string | null | undefined,
  fallback?: SupportedCurrency
): SupportedCurrency | null {
  if (c === null || c === undefined) return fallback ?? null;
  const trimmed = c.trim().toUpperCase();
  if (!trimmed) return fallback ?? null;
  return isSupportedCurrency(trimmed) ? trimmed : null;
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yStr, mStr, dStr] = value.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidYearMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const [yStr, mStr] = value.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  return Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12;
}

export function shortId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export function slugifyId(name: string, maxLen = 40): string {
  const base = name
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen)
    .replace(/_+$/g, '');
  return base || shortId().slice(0, 8);
}

export function defaultColorForAccountType(type: AccountType): string {
  switch (type) {
    case 'cash':
      return '#22C55E';
    case 'savings':
      return '#0EA5E9';
    case 'credit_card':
      return '#18181B';
    default:
      return '#009EE3';
  }
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
  const safe = Number.isFinite(amount) ? amount : 0;
  const normalized = Math.abs(safe) < 0.005 ? 0 : safe;
  const abs = Math.abs(normalized);
  const formatted = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(abs);
  const upper = (currency || 'ARS').toUpperCase();
  const prefix = upper === 'USD' ? 'US$' : upper === 'BRL' ? 'R$' : '$';
  const sign = normalized < 0 ? '-' : '';
  return `${sign}${prefix} ${formatted}`;
}

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

export function todayInTimezone(tz = 'America/Argentina/Buenos_Aires'): string {
  let formatter = dateFormatterCache.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatterCache.set(tz, formatter);
  }
  const parts = formatter.formatToParts(new Date());
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

export function addMonths(ym: string, delta: number): string {
  const [yStr, mStr] = ym.split('-');
  const year = Number(yStr);
  const monthIdx = Number(mStr) - 1;
  const d = new Date(Date.UTC(year, monthIdx + delta, 1));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function monthDiff(startYm: string, endYm: string): number {
  const [sy, sm] = startYm.split('-').map(Number);
  const [ey, em] = endYm.split('-').map(Number);
  return (ey - sy) * 12 + (em - sm);
}

export function previousMonths(endMonth: string, count: number): string[] {
  const result: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    result.push(addMonths(endMonth, -i));
  }
  return result;
}

export function defaultCardStatementMonth(
  occurredAt: string,
  closingDay?: number | null
): string {
  const ym = occurredAt.slice(0, 7);
  if (!closingDay || !Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) {
    return addMonths(ym, 1);
  }
  const [y, m] = ym.split('-').map(Number);
  const day = Number(occurredAt.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) {
    return addMonths(ym, 1);
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const effectiveClosingDay = Math.min(closingDay, lastDay);
  return day <= effectiveClosingDay ? addMonths(ym, 1) : addMonths(ym, 2);
}

export function slugifyTag(name: string, maxLen = 32): string {
  return name
    .trim()
    .replace(/^#/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen)
    .replace(/_+$/g, '');
}
