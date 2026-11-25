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

export type TransactionType =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'investment'
  | 'third_party'
  | 'third_party_repayment'
  | 'adjustment';

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

export interface Tag {
  id: string;
  name: string;
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
  installments_total: number | null;
  first_installment_month: string | null;
  third_party_name: string | null;
  linked_group_id: string | null;
  tags: string[];
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
  installments_total?: number | null;
  first_installment_month?: string | null;
  third_party_name?: string | null;
  linked_group_id?: string | null;
  tags?: string[];
}

export interface SharedPurchaseInput {
  account_id: string;
  currency?: string;
  category_id?: string | null;
  description: string;
  occurred_at: string;
  own_amount: number;
  third_party_amount: number;
  third_party_name: string;
  installments_total?: number | null;
  first_installment_month?: string | null;
  tags?: string[];
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
  tags: string[];
  installments_total: number | null;
  first_installment_month: string | null;
  third_party_name: string | null;
  shared_third_party_amount: number | null;
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

export interface TagBreakdown {
  tag_id: string;
  name: string;
  color: string;
  total: number;
  percentage: number;
}

export interface ThirdPartyBalance {
  person: string;
  pending: number;
}

export interface MonthSummary {
  month: string;
  income: number;
  expense: number;
  investment: number;
  net: number;
  net_after_investment: number;
  usd_expense: number;
  by_category: CategoryBreakdown[];
  by_tag: TagBreakdown[];
  third_party_pending: number;
  third_party_by_person: ThirdPartyBalance[];
  accounts: AccountWithBalance[];
}

export interface MonthlyHistoryPoint {
  month: string;
  income: number;
  expense: number;
}

export interface RecurringItem {
  id: string;
  name: string;
  type: 'expense' | 'income';
  amount: number;
  currency: string;
  account_id: string;
  category_id: string | null;
  day_of_month: number | null;
  active: number;
  created_at: string;
}

export interface RecurringItemInput {
  name: string;
  type?: 'expense' | 'income';
  amount: number;
  currency?: string;
  account_id: string;
  category_id?: string | null;
  day_of_month?: number | null;
  active?: number;
}

export interface ProjectedInstallment {
  transaction_id: string;
  description: string;
  account_id: string;
  installment_number: number;
  installments_total: number;
  installment_amount: number;
  third_party_name: string | null;
}

export interface MonthProjection {
  month: string;
  installments: ProjectedInstallment[];
  installments_total_amount: number;
  recurring: RecurringItem[];
  recurring_total_amount: number;
  total_committed: number;
}

export interface FutureProjection {
  start_month: string;
  reservas_balance: number;
  next_month_coverage_delta: number;
  months: MonthProjection[];
}
