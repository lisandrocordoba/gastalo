import type {
  AccountType,
  AccountWithBalance,
  AccountingBasis,
  BootstrapResponse,
  Category,
  RecurringItem,
  Tag,
  Transaction,
  TransactionType,
} from './types';

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

function buildHeaders(hasBody = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
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
  const hasBody = options?.body !== undefined;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...buildHeaders(hasBody),
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

export function fetchBootstrap(
  params: {
    from: string;
    to: string;
    basis: AccountingBasis;
    statementMonth: string;
  },
  options?: { signal?: AbortSignal }
): Promise<BootstrapResponse> {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
    basis: params.basis,
    statementMonth: params.statementMonth,
  });
  return apiFetch<BootstrapResponse>(`/api/bootstrap?${qs.toString()}`, {
    signal: options?.signal,
  });
}

export interface CreateTransactionPayload {
  type: TransactionType;
  amount: number;
  currency: string;
  account_id: string;
  to_account_id?: string | null;
  category_id?: string | null;
  description: string;
  occurred_at: string;
  tags?: string[];
  installments_total?: number | null;
  first_installment_month?: string | null;
  statement_month?: string | null;
  budget_month?: string | null;
  third_party_name?: string | null;
}

export function createTransaction(input: CreateTransactionPayload): Promise<{ transaction: Transaction }> {
  return apiFetch('/api/transactions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface CreateSharedPurchasePayload {
  account_id: string;
  currency: string;
  category_id?: string | null;
  description: string;
  occurred_at: string;
  own_amount: number;
  third_party_amount: number;
  third_party_name: string;
  installments_total?: number | null;
  first_installment_month?: string | null;
  tags?: string[];
}

export function createSharedPurchase(
  input: CreateSharedPurchasePayload
): Promise<{ linked_group_id: string; transactions: Transaction[] }> {
  return apiFetch('/api/transactions/shared', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTransaction(
  id: string,
  patch: Partial<CreateTransactionPayload>
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

export function createAccount(payload: {
  name: string;
  type: AccountType;
  currency: string;
  initial_balance?: number;
  color?: string;
  is_default?: number;
  due_day?: number | null;
}): Promise<{ account: AccountWithBalance; accounts: AccountWithBalance[] }> {
  return apiFetch('/api/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAccount(
  id: string,
  patch: Partial<{
    name: string;
    type: AccountType;
    currency: string;
    initial_balance: number;
    color: string;
    is_default: number;
    due_day: number | null;
  }>
): Promise<{ account: AccountWithBalance; accounts: AccountWithBalance[] }> {
  return apiFetch(`/api/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteAccount(id: string): Promise<{ ok: boolean; accounts: AccountWithBalance[] }> {
  return apiFetch(`/api/accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function updateAccountInitialBalance(id: string, initial_balance: number): Promise<unknown> {
  return updateAccount(id, { initial_balance });
}

export function reconcileAccount(
  id: string,
  real_balance: number,
  description?: string
): Promise<unknown> {
  return apiFetch(`/api/accounts/${encodeURIComponent(id)}/reconcile`, {
    method: 'POST',
    body: JSON.stringify({ real_balance, description }),
  });
}

export function payCardStatement(
  cardId: string,
  payload: {
    statement_month: string;
    from_account_id: string;
    amount: number;
    fees_amount?: number;
    occurred_at: string;
    description?: string;
  }
): Promise<unknown> {
  return apiFetch(`/api/cards/${encodeURIComponent(cardId)}/pay-statement`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createCategory(payload: {
  name: string;
  icon: string;
  type: 'expense' | 'income' | 'both';
  color: string;
}): Promise<{ category: Category; categories: Category[] }> {
  return apiFetch('/api/categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCategory(
  id: string,
  patch: Partial<{
    name: string;
    icon: string;
    type: 'expense' | 'income' | 'both';
    color: string;
  }>
): Promise<{ category: Category; categories: Category[] }> {
  return apiFetch(`/api/categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteCategory(id: string): Promise<{ ok: boolean; categories: Category[] }> {
  return apiFetch(`/api/categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function createTag(name: string, color?: string): Promise<{ tag: Tag }> {
  return apiFetch('/api/tags', {
    method: 'POST',
    body: JSON.stringify({ name, color }),
  });
}

export function updateTag(
  id: string,
  patch: Partial<{ name: string; color: string }>
): Promise<{ tag: Tag; tags: Tag[] }> {
  return apiFetch(`/api/tags/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteTag(id: string): Promise<{ ok: boolean; tags: Tag[] }> {
  return apiFetch(`/api/tags/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function createRecurringItem(input: {
  name: string;
  type?: 'expense' | 'income';
  amount: number;
  currency?: string;
  account_id: string;
  category_id?: string | null;
  day_of_month?: number | null;
  start_month?: string | null;
  active?: number;
}): Promise<{ recurringItem: RecurringItem }> {
  return apiFetch('/api/recurring', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateRecurringItem(
  id: string,
  patch: Partial<{
    name: string;
    amount: number;
    currency: string;
    account_id: string;
    category_id: string | null;
    day_of_month: number | null;
    start_month: string | null;
    active: number;
  }>
): Promise<{ recurringItem: RecurringItem }> {
  return apiFetch(`/api/recurring/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteRecurringItem(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/recurring/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function downloadCsv(from: string, to: string): Promise<void> {
  const qs = new URLSearchParams({ from, to });
  const res = await fetch(`/api/export.csv?${qs.toString()}`, {
    headers: buildHeaders(false),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error('No se pudo exportar el CSV');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gasti-movimientos-${from}_${to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
