import type {
  Account,
  AccountWithBalance,
  Category,
  CategoryBreakdown,
  MonthSummary,
  MonthlyHistoryPoint,
  Transaction,
  TransactionInput,
} from './types';
import { getMonthDateRange, previousMonths, shortId } from './utils';

export function computeAccountBalances(
  accounts: Account[],
  transactions: Pick<Transaction, 'type' | 'amount' | 'account_id' | 'to_account_id'>[]
): AccountWithBalance[] {
  const map = new Map<string, number>();
  for (const acc of accounts) {
    map.set(acc.id, acc.initial_balance);
  }

  for (const tx of transactions) {
    if (tx.type === 'income') {
      map.set(tx.account_id, (map.get(tx.account_id) ?? 0) + tx.amount);
    } else if (tx.type === 'expense') {
      map.set(tx.account_id, (map.get(tx.account_id) ?? 0) - tx.amount);
    } else if (tx.type === 'transfer') {
      map.set(tx.account_id, (map.get(tx.account_id) ?? 0) - tx.amount);
      if (tx.to_account_id) {
        map.set(tx.to_account_id, (map.get(tx.to_account_id) ?? 0) + tx.amount);
      }
    }
  }

  return accounts.map((acc) => ({
    ...acc,
    balance: Math.round((map.get(acc.id) ?? acc.initial_balance) * 100) / 100,
  }));
}

export async function listAccountsWithBalances(db: D1Database): Promise<AccountWithBalance[]> {
  const [accRes, txRes] = await Promise.all([
    db.prepare('SELECT * FROM accounts ORDER BY is_default DESC, name ASC').all<Account>(),
    db
      .prepare('SELECT type, amount, account_id, to_account_id FROM transactions')
      .all<Pick<Transaction, 'type' | 'amount' | 'account_id' | 'to_account_id'>>(),
  ]);

  return computeAccountBalances(accRes.results ?? [], txRes.results ?? []);
}

export async function updateAccountInitialBalance(
  db: D1Database,
  accountId: string,
  initialBalance: number
): Promise<Account | null> {
  await db
    .prepare('UPDATE accounts SET initial_balance = ? WHERE id = ?')
    .bind(initialBalance, accountId)
    .run();
  return db.prepare('SELECT * FROM accounts WHERE id = ?').bind(accountId).first<Account>();
}

export async function listCategories(db: D1Database): Promise<Category[]> {
  const res = await db.prepare('SELECT * FROM categories ORDER BY type ASC, name ASC').all<Category>();
  return res.results ?? [];
}

export async function createTransaction(db: D1Database, input: TransactionInput): Promise<Transaction> {
  const id = input.id ?? shortId();
  const createdAt = new Date().toISOString();
  const currency = input.currency ?? 'ARS';
  const toAccountId = input.type === 'transfer' ? (input.to_account_id ?? null) : null;
  const categoryId = input.type === 'transfer' ? null : (input.category_id ?? null);

  await db
    .prepare(
      `INSERT INTO transactions (
        id, type, amount, currency, account_id, to_account_id, category_id,
        description, occurred_at, source, raw_input, telegram_message_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.type,
      input.amount,
      currency,
      input.account_id,
      toAccountId,
      categoryId,
      input.description,
      input.occurred_at,
      input.source,
      input.raw_input ?? null,
      input.telegram_message_id ?? null,
      createdAt
    )
    .run();

  const row = await getTransactionById(db, id);
  if (!row) throw new Error('Failed to retrieve created transaction');
  return row;
}

export async function getTransactionById(db: D1Database, id: string): Promise<Transaction | null> {
  return db.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<Transaction>();
}

export async function updateTransaction(
  db: D1Database,
  id: string,
  patch: Partial<
    Pick<
      Transaction,
      'type' | 'amount' | 'currency' | 'account_id' | 'to_account_id' | 'category_id' | 'description' | 'occurred_at'
    >
  >
): Promise<Transaction | null> {
  const existing = await getTransactionById(db, id);
  if (!existing) return null;

  const nextType = patch.type ?? existing.type;
  const nextAmount = patch.amount ?? existing.amount;
  const nextCurrency = patch.currency ?? existing.currency;
  const nextAccountId = patch.account_id ?? existing.account_id;
  const nextToAccountId =
    nextType === 'transfer'
      ? patch.to_account_id !== undefined
        ? patch.to_account_id
        : existing.to_account_id
      : null;
  const nextCategoryId =
    nextType === 'transfer'
      ? null
      : patch.category_id !== undefined
        ? patch.category_id
        : existing.category_id;
  const nextDescription = patch.description ?? existing.description;
  const nextOccurredAt = patch.occurred_at ?? existing.occurred_at;

  await db
    .prepare(
      `UPDATE transactions
       SET type = ?, amount = ?, currency = ?, account_id = ?, to_account_id = ?,
           category_id = ?, description = ?, occurred_at = ?
       WHERE id = ?`
    )
    .bind(
      nextType,
      nextAmount,
      nextCurrency,
      nextAccountId,
      nextToAccountId,
      nextCategoryId,
      nextDescription,
      nextOccurredAt,
      id
    )
    .run();

  return getTransactionById(db, id);
}

export async function deleteTransaction(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

export interface TransactionFilters {
  month?: string;
  accountId?: string;
  categoryId?: string;
  search?: string;
  limit?: number;
}

export async function listTransactions(
  db: D1Database,
  filters: TransactionFilters = {}
): Promise<Transaction[]> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (filters.month) {
    const { start, end } = getMonthDateRange(filters.month);
    conditions.push('occurred_at >= ? AND occurred_at <= ?');
    bindings.push(start, end);
  }
  if (filters.accountId) {
    conditions.push('(account_id = ? OR to_account_id = ?)');
    bindings.push(filters.accountId, filters.accountId);
  }
  if (filters.categoryId) {
    conditions.push('category_id = ?');
    bindings.push(filters.categoryId);
  }
  if (filters.search) {
    conditions.push('LOWER(description) LIKE ?');
    bindings.push(`%${filters.search.toLowerCase()}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 500) : 200;

  const sql = `SELECT * FROM transactions ${where} ORDER BY occurred_at DESC, created_at DESC LIMIT ?`;
  bindings.push(limit);

  const res = await db.prepare(sql).bind(...bindings).all<Transaction>();
  return res.results ?? [];
}

export async function getMonthSummary(db: D1Database, month: string): Promise<MonthSummary> {
  const { start, end } = getMonthDateRange(month);
  const [txRes, categories, accounts] = await Promise.all([
    db
      .prepare('SELECT * FROM transactions WHERE occurred_at >= ? AND occurred_at <= ?')
      .bind(start, end)
      .all<Transaction>(),
    listCategories(db),
    listAccountsWithBalances(db),
  ]);

  const txs = txRes.results ?? [];
  let income = 0;
  let expense = 0;
  const catTotals = new Map<string, number>();

  for (const tx of txs) {
    if (tx.type === 'income') {
      income += tx.amount;
    } else if (tx.type === 'expense') {
      expense += tx.amount;
      const catId = tx.category_id ?? 'otros';
      catTotals.set(catId, (catTotals.get(catId) ?? 0) + tx.amount);
    }
  }

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const byCategory: CategoryBreakdown[] = Array.from(catTotals.entries())
    .map(([categoryId, total]) => {
      const cat = catMap.get(categoryId);
      return {
        category_id: categoryId,
        name: cat?.name ?? 'Otros',
        icon: cat?.icon ?? '📦',
        color: cat?.color ?? '#71717a',
        total: Math.round(total * 100) / 100,
        percentage: expense > 0 ? Math.round((total / expense) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    month,
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
    net: Math.round((income - expense) * 100) / 100,
    by_category: byCategory,
    accounts,
  };
}

export async function getMonthlyHistory(
  db: D1Database,
  endMonth: string,
  months = 6
): Promise<MonthlyHistoryPoint[]> {
  const monthList = previousMonths(endMonth, months);
  const start = `${monthList[0]}-01`;
  const { end } = getMonthDateRange(endMonth);

  const res = await db
    .prepare(
      `SELECT substr(occurred_at, 1, 7) as month, type, SUM(amount) as total
       FROM transactions
       WHERE occurred_at >= ? AND occurred_at <= ? AND type IN ('income', 'expense')
       GROUP BY substr(occurred_at, 1, 7), type`
    )
    .bind(start, end)
    .all<{ month: string; type: 'income' | 'expense'; total: number }>();

  const map = new Map<string, { income: number; expense: number }>();
  for (const m of monthList) {
    map.set(m, { income: 0, expense: 0 });
  }
  for (const row of res.results ?? []) {
    const entry = map.get(row.month);
    if (entry) {
      entry[row.type] = Math.round(row.total * 100) / 100;
    }
  }

  return monthList.map((m) => ({
    month: m,
    income: map.get(m)?.income ?? 0,
    expense: map.get(m)?.expense ?? 0,
  }));
}
