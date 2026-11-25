import type { BootstrapResponse, Transaction, TransactionType } from './types';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
      };
    };
  }
}

const TOKEN_STORAGE_KEY = 'gasti_dashboard_token';

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
}

export function setStoredToken(token: string): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getTelegramInitData(): string {
  return window.Telegram?.WebApp?.initData ?? '';
}

function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const initData = getTelegramInitData();
  if (initData) {
    headers['X-Telegram-Init-Data'] = initData;
  }
  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
  }
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...buildHeaders(),
      ...(options?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchBootstrap(month: string): Promise<BootstrapResponse> {
  return apiFetch<BootstrapResponse>(`/api/bootstrap?month=${encodeURIComponent(month)}`);
}

export function createTransaction(input: {
  type: TransactionType;
  amount: number;
  currency: string;
  account_id: string;
  to_account_id?: string | null;
  category_id?: string | null;
  description: string;
  occurred_at: string;
}): Promise<{ transaction: Transaction }> {
  return apiFetch('/api/transactions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTransaction(
  id: string,
  patch: Partial<{
    type: TransactionType;
    amount: number;
    currency: string;
    account_id: string;
    to_account_id: string | null;
    category_id: string | null;
    description: string;
    occurred_at: string;
  }>
): Promise<{ transaction: Transaction }> {
  return apiFetch(`/api/transactions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteTransaction(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/transactions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function updateAccountInitialBalance(id: string, initial_balance: number): Promise<unknown> {
  return apiFetch(`/api/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ initial_balance }),
  });
}

export async function downloadCsv(month: string): Promise<void> {
  const res = await fetch(`/api/export.csv?month=${encodeURIComponent(month)}`, {
    headers: buildHeaders(),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error('No se pudo exportar el CSV');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gasti-movimientos-${month}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function formatMoney(amount: number, currency = 'ARS'): string {
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(abs);
  const prefix = currency.toUpperCase() === 'USD' ? 'US$' : '$';
  const sign = amount < 0 ? '-' : '';
  return `${sign}${prefix} ${formatted}`;
}
