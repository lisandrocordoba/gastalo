export type AccountType = 'wallet' | 'savings' | 'credit_card' | 'cash';
export type TransactionType = 'expense' | 'income' | 'transfer';

export interface AccountWithBalance {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  initial_balance: number;
  is_default: number;
  balance: number;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  type: 'expense' | 'income' | 'both';
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
  created_at: string;
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

export interface BootstrapResponse {
  month: string;
  accounts: AccountWithBalance[];
  categories: Category[];
  summary: MonthSummary;
  monthlyHistory: MonthlyHistoryPoint[];
  transactions: Transaction[];
}
