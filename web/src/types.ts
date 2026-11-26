export type AccountType = 'wallet' | 'savings' | 'credit_card' | 'cash';

export type AccountingBasis = 'cash' | 'accrual';

export type TransactionType =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'investment'
  | 'third_party'
  | 'third_party_repayment'
  | 'adjustment';

export interface AccountWithBalance {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  initial_balance: number;
  color: string;
  is_default: number;
  due_day?: number | null;
  balance: number;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  type: 'expense' | 'income' | 'both';
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
  installments_total: number | null;
  first_installment_month: string | null;
  statement_month: string | null;
  budget_month: string | null;
  third_party_name: string | null;
  linked_group_id: string | null;
  tags: string[];
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

export interface CardStatementItem {
  transaction_id: string;
  description: string;
  type: 'expense' | 'third_party';
  category_id: string | null;
  tags: string[];
  installment_number: number;
  installments_total: number;
  installment_amount: number;
  third_party_name: string | null;
  occurred_at: string;
}

export interface CardStatementRecurringItem {
  recurring_id: string;
  name: string;
  amount: number;
  currency: string;
  category_id: string | null;
  day_of_month: number | null;
  start_month: string | null;
  posted_transaction_id: string | null;
}

export interface CardStatement {
  account_id: string;
  account_name: string;
  currency: string;
  card_debt: number;
  statement_month: string;
  due_day: number | null;
  due_date: string | null;
  is_overdue: boolean;
  total_due: number;
  own_total: number;
  third_party_total: number;
  status: 'pending' | 'paid';
  paid_transaction_id: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  items: CardStatementItem[];
  recurring_items: CardStatementRecurringItem[];
}

export interface OverdueCardAlert {
  account_id: string;
  account_name: string;
  currency: string;
  statement_month: string;
  due_date: string;
  total_due: number;
}

export interface PaidStatementItem {
  transaction_id: string;
  payment_transaction_id: string;
  card_account_id: string;
  card_account_name: string;
  statement_month: string;
  paid_at: string;
  occurred_at: string;
  description: string;
  category_id: string | null;
  tags: string[];
  installment_number: number;
  installments_total: number;
  installment_amount: number;
  prorated_amount: number;
  currency: string;
}

export interface MonthSummary {
  month: string;
  from: string;
  to: string;
  basis: AccountingBasis;
  income: number;
  expense: number;
  card_purchases: number;
  card_purchases_usd: number;
  investment: number;
  net: number;
  net_after_investment: number;
  usd_expense: number;
  by_category: CategoryBreakdown[];
  by_tag: TagBreakdown[];
  third_party_pending: number;
  third_party_by_person: ThirdPartyBalance[];
  accounts: AccountWithBalance[];
  card_statements: CardStatement[];
  overdue_card_alerts: OverdueCardAlert[];
  paid_statement_items?: PaidStatementItem[];
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
  start_month: string | null;
  active: number;
  created_at: string;
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
  recurring_usd_total_amount: number;
  total_committed: number;
}

export interface FutureProjection {
  start_month: string;
  reservas_balance: number;
  next_month_coverage_delta: number;
  months: MonthProjection[];
}

export interface BootstrapResponse {
  month: string;
  from: string;
  to: string;
  basis: AccountingBasis;
  statementMonth: string;
  accounts: AccountWithBalance[];
  categories: Category[];
  tags: Tag[];
  summary: MonthSummary;
  monthlyHistory: MonthlyHistoryPoint[];
  transactions: Transaction[];
  referencedTransactions?: Transaction[];
  today?: string;
  timezone?: string;
  recurringItems: RecurringItem[];
  projection: FutureProjection;
  cardStatements: CardStatement[];
  overdueStatements: OverdueCardAlert[];
}
