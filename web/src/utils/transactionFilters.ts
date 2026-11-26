import type { PaidStatementItem, Transaction } from '../types';

export type SortKey = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

export interface TransactionFilterOptions {
  cardAccountIds: Set<string>;
  cardPurchasesOnly: boolean;
  selectedAccount: string;
  selectedCategory: string;
  typeFilter: string;
  selectedTag: string;
  search: string;
}

/**
 * Resolves the effective sorting date for a transaction, prioritizing valid YYYY-MM budget_month.
 */
export function effectiveTransactionDate(
  tx: Pick<Transaction, 'occurred_at' | 'budget_month'>
): string {
  return tx.budget_month && /^\d{4}-\d{2}$/.test(tx.budget_month)
    ? `${tx.budget_month}-01`
    : tx.occurred_at;
}

/**
 * Filters transactions using active UI filters, mapping uncategorized expenses to 'otros'.
 */
export function filterTransactions(
  transactions: Transaction[],
  opts: TransactionFilterOptions
): Transaction[] {
  const q = opts.search.trim().toLowerCase();
  return transactions.filter((tx) => {
    if (opts.cardPurchasesOnly && !(tx.type === 'expense' && opts.cardAccountIds.has(tx.account_id))) {
      return false;
    }
    if (
      opts.selectedAccount &&
      tx.account_id !== opts.selectedAccount &&
      tx.to_account_id !== opts.selectedAccount
    ) {
      return false;
    }
    if (opts.selectedCategory) {
      if (opts.selectedCategory === 'otros') {
        const isUncategorizedExpense = tx.type === 'expense' && tx.category_id === null;
        if (tx.category_id !== 'otros' && !isUncategorizedExpense) {
          return false;
        }
      } else if (tx.category_id !== opts.selectedCategory) {
        return false;
      }
    }
    if (opts.typeFilter && tx.type !== opts.typeFilter) {
      return false;
    }
    if (opts.selectedTag && !tx.tags.includes(opts.selectedTag)) {
      return false;
    }
    if (q) {
      const matchDesc = tx.description.toLowerCase().includes(q);
      const matchThird = (tx.third_party_name ?? '').toLowerCase().includes(q);
      if (!matchDesc && !matchThird) return false;
    }
    return true;
  });
}

/**
 * Sorts transactions by effective date (with occurred_at and created_at tie-breakers) or amount.
 */
export function sortTransactions(transactions: Transaction[], sortBy: SortKey): Transaction[] {
  return [...transactions].sort((a, b) => {
    if (sortBy === 'date_asc') {
      return (
        effectiveTransactionDate(a).localeCompare(effectiveTransactionDate(b)) ||
        a.occurred_at.localeCompare(b.occurred_at) ||
        a.created_at.localeCompare(b.created_at)
      );
    }
    if (sortBy === 'amount_desc') {
      return Math.abs(b.amount) - Math.abs(a.amount);
    }
    if (sortBy === 'amount_asc') {
      return Math.abs(a.amount) - Math.abs(b.amount);
    }
    return (
      effectiveTransactionDate(b).localeCompare(effectiveTransactionDate(a)) ||
      b.occurred_at.localeCompare(a.occurred_at) ||
      b.created_at.localeCompare(a.created_at)
    );
  });
}

/**
 * Filters paid statement items when any drill-down filter is active and compatible with card expenses.
 */
export function filterPaidStatementItems(
  items: PaidStatementItem[],
  opts: Omit<TransactionFilterOptions, 'cardAccountIds'>
): PaidStatementItem[] {
  const q = opts.search.trim().toLowerCase();
  const hasDrilldownFilter = Boolean(
    opts.selectedCategory || opts.selectedTag || opts.selectedAccount || q
  );
  if (!hasDrilldownFilter) return [];
  if (opts.cardPurchasesOnly) return [];
  if (opts.typeFilter && opts.typeFilter !== 'expense') return [];

  return items.filter((item) => {
    if (opts.selectedCategory && (item.category_id ?? 'otros') !== opts.selectedCategory) {
      return false;
    }
    if (opts.selectedTag && !item.tags.includes(opts.selectedTag)) {
      return false;
    }
    if (opts.selectedAccount && item.card_account_id !== opts.selectedAccount) {
      return false;
    }
    if (q && !item.description.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
}
