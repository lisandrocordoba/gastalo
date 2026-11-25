export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GEMINI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ALLOWED_TELEGRAM_USER_ID: string;
  DASHBOARD_TOKEN: string;
  DASHBOARD_URL?: string;
  APP_ENV: string;
  DEFAULT_CURRENCY: string;
  TIMEZONE: string;
}

export type AccountType = 'wallet' | 'savings' | 'credit_card' | 'cash';
export type TransactionType = 'expense' | 'income' | 'transfer';
export type CategoryType = 'expense' | 'income' | 'both';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  initial_balance: number;
  is_default: number;
  created_at: string;
}

export interface AccountWithBalance extends Account {
  balance: number;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  type: CategoryType;
  color: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  currency: string;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  description: string;
  occurred_at: string;
  source: string;
  raw_input: string | null;
  telegram_message_id: number | null;
  created_at: string;
}

export interface TransactionInput {
  id?: string;
  type: TransactionType;
  amount: number;
  currency?: string;
  account_id: string;
  to_account_id?: string | null;
  category_id?: string | null;
  description: string;
  occurred_at: string;
  source: string;
  raw_input?: string | null;
  telegram_message_id?: number | null;
}

export interface ParsedTransactionDraft {
  type: TransactionType;
  amount: number;
  currency: string;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  description: string;
  occurred_at: string;
}

export interface ParsedIntent {
  intent: 'record' | 'query' | 'unknown';
  reply_text?: string;
  transactions: ParsedTransactionDraft[];
}

export interface CategoryBreakdown {
  category_id: string;
  name: string;
  icon: string;
  color: string;
  total: number;
  percentage: number;
}

export interface MonthSummary {
  month: string;
  income: number;
  expense: number;
  net: number;
  by_category: CategoryBreakdown[];
  accounts: AccountWithBalance[];
}

export interface MonthlyHistoryPoint {
  month: string;
  income: number;
  expense: number;
}
