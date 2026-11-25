import type {
  Account,
  AccountWithBalance,
  Category,
  CategoryBreakdown,
  FutureProjection,
  MonthProjection,
  MonthSummary,
  MonthlyHistoryPoint,
  ProjectedInstallment,
  RecurringItem,
  RecurringItemInput,
  SharedPurchaseInput,
  Tag,
  TagBreakdown,
  ThirdPartyBalance,
  Transaction,
  TransactionInput,
  TransactionType,
} from './types';
import { addMonths, getMonthDateRange, monthDiff, previousMonths, shortId, slugifyTag } from './utils';

type RawTransactionRow = Omit<Transaction, 'tags'>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeAccountBalances(
  accounts: Account[],
  transactions: Pick<Transaction, 'type' | 'amount' | 'account_id' | 'to_account_id'>[]
): AccountWithBalance[] {
  const map = new Map<string, number>();
  for (const acc of accounts) {
    map.set(acc.id, acc.initial_balance);
  }

  for (const tx of transactions) {
    if (tx.type === 'income' || tx.type === 'third_party_repayment' || tx.type === 'adjustment') {
      map.set(tx.account_id, (map.get(tx.account_id) ?? 0) + tx.amount);
    } else if (tx.type === 'expense' || tx.type === 'investment' || tx.type === 'third_party') {
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
    balance: round2(map.get(acc.id) ?? acc.initial_balance),
  }));
}

export function computeThirdPartyBalances(
  transactions: Pick<Transaction, 'type' | 'amount' | 'third_party_name'>[]
): { total_pending: number; by_person: ThirdPartyBalance[] } {
  const map = new Map<string, { display: string; pending: number }>();

  for (const tx of transactions) {
    if (tx.type !== 'third_party' && tx.type !== 'third_party_repayment') continue;
    const rawName = (tx.third_party_name ?? '').trim();
    const key = (rawName || 'sin_nombre').toLowerCase();
    const display = rawName || 'Sin nombre';

    const entry = map.get(key) ?? { display, pending: 0 };
    if (tx.type === 'third_party') {
      entry.pending += tx.amount;
    } else {
      entry.pending -= tx.amount;
    }
    map.set(key, entry);
  }

  const byPerson: ThirdPartyBalance[] = [];
  let totalPending = 0;

  for (const entry of map.values()) {
    const rounded = round2(entry.pending);
    if (Math.abs(rounded) >= 0.01) {
      byPerson.push({ person: entry.display, pending: rounded });
      totalPending += rounded;
    }
  }

  byPerson.sort((a, b) => Math.abs(b.pending) - Math.abs(a.pending));
  return {
    total_pending: round2(totalPending),
    by_person: byPerson,
  };
}

export function computeFutureProjection(
  transactions: Pick<
    Transaction,
    'id' | 'type' | 'amount' | 'currency' | 'account_id' | 'description' | 'installments_total' | 'first_installment_month' | 'third_party_name'
  >[],
  recurringItems: RecurringItem[],
  reservasBalance: number,
  startMonth: string,
  monthsAhead = 3
): FutureProjection {
  const activeRecurring = recurringItems.filter(
    (item) => item.active === 1 && item.type === 'expense' && item.currency === 'ARS'
  );
  const recurringTotal = round2(activeRecurring.reduce((sum, item) => sum + item.amount, 0));

  const months: MonthProjection[] = [];
  for (let i = 0; i < monthsAhead; i++) {
    const targetMonth = addMonths(startMonth, i);
    const installments: ProjectedInstallment[] = [];

    for (const tx of transactions) {
      if (tx.currency !== 'ARS') continue;
      if (tx.type !== 'expense' && tx.type !== 'third_party') continue;
      if (!tx.installments_total || tx.installments_total < 1 || !tx.first_installment_month) continue;
      if (!/^\d{4}-\d{2}$/.test(tx.first_installment_month)) continue;

      const idx = monthDiff(tx.first_installment_month, targetMonth);
      if (idx >= 0 && idx < tx.installments_total) {
        installments.push({
          transaction_id: tx.id,
          description: tx.description,
          account_id: tx.account_id,
          installment_number: idx + 1,
          installments_total: tx.installments_total,
          installment_amount: round2(tx.amount / tx.installments_total),
          third_party_name: tx.third_party_name,
        });
      }
    }

    const installmentsTotal = round2(
      installments.reduce((sum, item) => sum + item.installment_amount, 0)
    );
    months.push({
      month: targetMonth,
      installments,
      installments_total_amount: installmentsTotal,
      recurring: activeRecurring,
      recurring_total_amount: recurringTotal,
      total_committed: round2(installmentsTotal + recurringTotal),
    });
  }

  const firstMonthCommitted = months[0]?.total_committed ?? 0;
  return {
    start_month: startMonth,
    reservas_balance: round2(reservasBalance),
    next_month_coverage_delta: round2(reservasBalance - firstMonthCommitted),
    months,
  };
}

async function hydrateTransactionTags(
  db: D1Database,
  rows: RawTransactionRow[]
): Promise<Transaction[]> {
  if (rows.length === 0) return [];

  const tagMap = new Map<string, string[]>();
  const chunkSize = 80;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    const res = await db
      .prepare(
        `SELECT transaction_id, tag_id FROM transaction_tags WHERE transaction_id IN (${placeholders}) ORDER BY tag_id ASC`
      )
      .bind(...chunk.map((r) => r.id))
      .all<{ transaction_id: string; tag_id: string }>();

    for (const rel of res.results ?? []) {
      const list = tagMap.get(rel.transaction_id) ?? [];
      list.push(rel.tag_id);
      tagMap.set(rel.transaction_id, list);
    }
  }

  return rows.map((row) => ({
    ...row,
    tags: tagMap.get(row.id) ?? [],
  }));
}

async function syncTransactionTags(
  db: D1Database,
  transactionId: string,
  rawTags: string[]
): Promise<void> {
  const uniqueSlugs = Array.from(
    new Set(rawTags.map(slugifyTag).filter((s) => s.length > 0))
  );

  await db.prepare('DELETE FROM transaction_tags WHERE transaction_id = ?').bind(transactionId).run();
  if (uniqueSlugs.length === 0) return;

  const stmts: D1PreparedStatement[] = [];
  for (const slug of uniqueSlugs) {
    stmts.push(
      db.prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)').bind(slug, slug, '#71717a')
    );
    stmts.push(
      db.prepare('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)').bind(transactionId, slug)
    );
  }
  await db.batch(stmts);
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

export async function reconcileAccountBalance(
  db: D1Database,
  accountId: string,
  realBalance: number,
  occurredAt: string,
  description?: string
): Promise<{ adjustment: Transaction | null; accounts: AccountWithBalance[] }> {
  const accounts = await listAccountsWithBalances(db);
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) {
    throw new Error('Cuenta no encontrada');
  }

  const diff = round2(realBalance - acc.balance);
  if (diff === 0) {
    return { adjustment: null, accounts };
  }

  const adjustment = await createTransaction(db, {
    type: 'adjustment',
    amount: diff,
    currency: acc.currency,
    account_id: accountId,
    description: description?.trim() || 'Conciliación de saldo',
    occurred_at: occurredAt,
    source: 'reconcile',
  });

  const updatedAccounts = await listAccountsWithBalances(db);
  return { adjustment, accounts: updatedAccounts };
}

export async function listCategories(db: D1Database): Promise<Category[]> {
  const res = await db.prepare('SELECT * FROM categories ORDER BY type ASC, name ASC').all<Category>();
  return res.results ?? [];
}

export async function listTags(db: D1Database): Promise<Tag[]> {
  const res = await db.prepare('SELECT * FROM tags ORDER BY name ASC').all<Tag>();
  return res.results ?? [];
}

export async function createTag(db: D1Database, name: string, color = '#71717a'): Promise<Tag> {
  const id = slugifyTag(name);
  if (!id) throw new Error('Nombre de etiqueta inválido');
  const displayName = name.trim().replace(/^#/, '') || id;
  await db
    .prepare(
      'INSERT INTO tags (id, name, color) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color'
    )
    .bind(id, displayName, color)
    .run();
  const row = await db.prepare('SELECT * FROM tags WHERE id = ?').bind(id).first<Tag>();
  if (!row) throw new Error('No se pudo crear la etiqueta');
  return row;
}

export async function createTransaction(db: D1Database, input: TransactionInput): Promise<Transaction> {
  const id = input.id ?? shortId();
  const createdAt = new Date().toISOString();
  const currency = input.currency ?? 'ARS';
  const toAccountId = input.type === 'transfer' ? (input.to_account_id ?? null) : null;
  const allowsCategory = input.type === 'expense' || input.type === 'income';
  const categoryId = allowsCategory ? (input.category_id ?? null) : null;
  const installmentsTotal =
    input.installments_total && input.installments_total >= 1 ? Math.trunc(input.installments_total) : null;
  const firstInstallmentMonth =
    installmentsTotal && input.first_installment_month
      ? input.first_installment_month
      : installmentsTotal
        ? input.occurred_at.slice(0, 7)
        : null;

  await db
    .prepare(
      `INSERT INTO transactions (
        id, type, amount, currency, account_id, to_account_id, category_id,
        description, occurred_at, source, raw_input, telegram_message_id,
        installments_total, first_installment_month, third_party_name, linked_group_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      installmentsTotal,
      firstInstallmentMonth,
      input.third_party_name ?? null,
      input.linked_group_id ?? null,
      createdAt
    )
    .run();

  if (input.tags && input.tags.length > 0) {
    await syncTransactionTags(db, id, input.tags);
  }

  const row = await getTransactionById(db, id);
  if (!row) throw new Error('Failed to retrieve created transaction');
  return row;
}

export async function createSharedPurchase(
  db: D1Database,
  input: SharedPurchaseInput
): Promise<{ linked_group_id: string; transactions: Transaction[] }> {
  const linkedGroupId = shortId();
  const created: Transaction[] = [];

  if (input.own_amount > 0) {
    const ownTx = await createTransaction(db, {
      type: 'expense',
      amount: round2(input.own_amount),
      currency: input.currency ?? 'ARS',
      account_id: input.account_id,
      category_id: input.category_id ?? 'otros',
      description: `${input.description.trim()} (mi parte)`,
      occurred_at: input.occurred_at,
      source: input.source,
      raw_input: input.raw_input ?? null,
      telegram_message_id: input.telegram_message_id ?? null,
      installments_total: input.installments_total ?? null,
      first_installment_month: input.first_installment_month ?? null,
      linked_group_id: linkedGroupId,
      tags: input.tags,
    });
    created.push(ownTx);
  }

  if (input.third_party_amount > 0) {
    const thirdTx = await createTransaction(db, {
      type: 'third_party',
      amount: round2(input.third_party_amount),
      currency: input.currency ?? 'ARS',
      account_id: input.account_id,
      description: `${input.description.trim()} (parte ${input.third_party_name.trim()})`,
      occurred_at: input.occurred_at,
      source: input.source,
      raw_input: input.raw_input ?? null,
      telegram_message_id: input.telegram_message_id ?? null,
      installments_total: input.installments_total ?? null,
      first_installment_month: input.first_installment_month ?? null,
      third_party_name: input.third_party_name.trim(),
      linked_group_id: linkedGroupId,
      tags: input.tags,
    });
    created.push(thirdTx);
  }

  return { linked_group_id: linkedGroupId, transactions: created };
}

export async function getTransactionById(db: D1Database, id: string): Promise<Transaction | null> {
  const row = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<RawTransactionRow>();
  if (!row) return null;
  const hydrated = await hydrateTransactionTags(db, [row]);
  return hydrated[0] ?? null;
}

export async function updateTransaction(
  db: D1Database,
  id: string,
  patch: Partial<
    Pick<
      Transaction,
      | 'type'
      | 'amount'
      | 'currency'
      | 'account_id'
      | 'to_account_id'
      | 'category_id'
      | 'description'
      | 'occurred_at'
      | 'installments_total'
      | 'first_installment_month'
      | 'third_party_name'
      | 'tags'
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
  const allowsCategory = nextType === 'expense' || nextType === 'income';
  const nextCategoryId = allowsCategory
    ? patch.category_id !== undefined
      ? patch.category_id
      : existing.category_id
    : null;
  const nextDescription = patch.description ?? existing.description;
  const nextOccurredAt = patch.occurred_at ?? existing.occurred_at;
  const nextInstallmentsTotal =
    patch.installments_total !== undefined ? patch.installments_total : existing.installments_total;
  const nextFirstInstallmentMonth =
    patch.first_installment_month !== undefined
      ? patch.first_installment_month
      : existing.first_installment_month;
  const nextThirdPartyName =
    patch.third_party_name !== undefined ? patch.third_party_name : existing.third_party_name;

  await db
    .prepare(
      `UPDATE transactions
       SET type = ?, amount = ?, currency = ?, account_id = ?, to_account_id = ?,
           category_id = ?, description = ?, occurred_at = ?,
           installments_total = ?, first_installment_month = ?, third_party_name = ?
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
      nextInstallmentsTotal,
      nextFirstInstallmentMonth,
      nextThirdPartyName,
      id
    )
    .run();

  if (patch.tags !== undefined) {
    await syncTransactionTags(db, id, patch.tags);
  }

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
  tagId?: string;
  type?: TransactionType;
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
    conditions.push('t.occurred_at >= ? AND t.occurred_at <= ?');
    bindings.push(start, end);
  }
  if (filters.accountId) {
    conditions.push('(t.account_id = ? OR t.to_account_id = ?)');
    bindings.push(filters.accountId, filters.accountId);
  }
  if (filters.categoryId) {
    conditions.push('t.category_id = ?');
    bindings.push(filters.categoryId);
  }
  if (filters.type) {
    conditions.push('t.type = ?');
    bindings.push(filters.type);
  }
  if (filters.tagId) {
    conditions.push('EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = ?)');
    bindings.push(slugifyTag(filters.tagId));
  }
  if (filters.search) {
    conditions.push('LOWER(t.description) LIKE ?');
    bindings.push(`%${filters.search.toLowerCase()}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 500) : 200;

  const sql = `SELECT t.* FROM transactions t ${where} ORDER BY t.occurred_at DESC, t.created_at DESC LIMIT ?`;
  bindings.push(limit);

  const res = await db.prepare(sql).bind(...bindings).all<RawTransactionRow>();
  return hydrateTransactionTags(db, res.results ?? []);
}

export async function getMonthSummary(db: D1Database, month: string): Promise<MonthSummary> {
  const { start, end } = getMonthDateRange(month);
  const [txRes, allThirdPartyRes, categories, tags, accounts] = await Promise.all([
    db
      .prepare('SELECT * FROM transactions WHERE occurred_at >= ? AND occurred_at <= ?')
      .bind(start, end)
      .all<RawTransactionRow>(),
    db
      .prepare("SELECT type, amount, third_party_name FROM transactions WHERE type IN ('third_party', 'third_party_repayment')")
      .all<Pick<Transaction, 'type' | 'amount' | 'third_party_name'>>(),
    listCategories(db),
    listTags(db),
    listAccountsWithBalances(db),
  ]);

  const txs = await hydrateTransactionTags(db, txRes.results ?? []);
  let income = 0;
  let expense = 0;
  let investment = 0;
  let usdExpense = 0;
  const catTotals = new Map<string, number>();
  const tagTotals = new Map<string, number>();

  for (const tx of txs) {
    if (tx.currency !== 'ARS') {
      if (tx.type === 'expense' && tx.currency === 'USD') {
        usdExpense += tx.amount;
      }
      continue;
    }

    if (tx.type === 'income') {
      income += tx.amount;
    } else if (tx.type === 'investment') {
      investment += tx.amount;
    } else if (tx.type === 'expense') {
      expense += tx.amount;
      const catId = tx.category_id ?? 'otros';
      catTotals.set(catId, (catTotals.get(catId) ?? 0) + tx.amount);
      for (const tagId of tx.tags) {
        tagTotals.set(tagId, (tagTotals.get(tagId) ?? 0) + tx.amount);
      }
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
        total: round2(total),
        percentage: expense > 0 ? Math.round((total / expense) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  const tagMap = new Map(tags.map((t) => [t.id, t]));
  const byTag: TagBreakdown[] = Array.from(tagTotals.entries())
    .map(([tagId, total]) => {
      const tag = tagMap.get(tagId);
      return {
        tag_id: tagId,
        name: tag?.name ?? tagId,
        color: tag?.color ?? '#71717a',
        total: round2(total),
        percentage: expense > 0 ? Math.round((total / expense) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  const thirdParty = computeThirdPartyBalances(allThirdPartyRes.results ?? []);

  return {
    month,
    income: round2(income),
    expense: round2(expense),
    investment: round2(investment),
    net: round2(income - expense),
    net_after_investment: round2(income - expense - investment),
    usd_expense: round2(usdExpense),
    by_category: byCategory,
    by_tag: byTag,
    third_party_pending: thirdParty.total_pending,
    third_party_by_person: thirdParty.by_person,
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
       WHERE occurred_at >= ? AND occurred_at <= ?
         AND currency = 'ARS'
         AND type IN ('income', 'expense')
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
      entry[row.type] = round2(row.total);
    }
  }

  return monthList.map((m) => ({
    month: m,
    income: map.get(m)?.income ?? 0,
    expense: map.get(m)?.expense ?? 0,
  }));
}

export async function listRecurringItems(db: D1Database): Promise<RecurringItem[]> {
  const res = await db
    .prepare('SELECT * FROM recurring_items ORDER BY active DESC, day_of_month ASC, name ASC')
    .all<RecurringItem>();
  return res.results ?? [];
}

export async function createRecurringItem(db: D1Database, input: RecurringItemInput): Promise<RecurringItem> {
  const id = shortId();
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO recurring_items (id, name, type, amount, currency, account_id, category_id, day_of_month, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.name.trim(),
      input.type ?? 'expense',
      round2(input.amount),
      input.currency ?? 'ARS',
      input.account_id,
      input.category_id ?? null,
      input.day_of_month ?? null,
      input.active ?? 1,
      createdAt
    )
    .run();

  const row = await db.prepare('SELECT * FROM recurring_items WHERE id = ?').bind(id).first<RecurringItem>();
  if (!row) throw new Error('No se pudo crear el gasto fijo');
  return row;
}

export async function updateRecurringItem(
  db: D1Database,
  id: string,
  patch: Partial<RecurringItemInput>
): Promise<RecurringItem | null> {
  const existing = await db.prepare('SELECT * FROM recurring_items WHERE id = ?').bind(id).first<RecurringItem>();
  if (!existing) return null;

  await db
    .prepare(
      `UPDATE recurring_items
       SET name = ?, type = ?, amount = ?, currency = ?, account_id = ?, category_id = ?, day_of_month = ?, active = ?
       WHERE id = ?`
    )
    .bind(
      patch.name !== undefined ? patch.name.trim() : existing.name,
      patch.type ?? existing.type,
      patch.amount !== undefined ? round2(patch.amount) : existing.amount,
      patch.currency ?? existing.currency,
      patch.account_id ?? existing.account_id,
      patch.category_id !== undefined ? patch.category_id : existing.category_id,
      patch.day_of_month !== undefined ? patch.day_of_month : existing.day_of_month,
      patch.active !== undefined ? patch.active : existing.active,
      id
    )
    .run();

  return db.prepare('SELECT * FROM recurring_items WHERE id = ?').bind(id).first<RecurringItem>();
}

export async function deleteRecurringItem(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM recurring_items WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function getFutureProjection(
  db: D1Database,
  startMonth: string,
  monthsAhead = 3
): Promise<FutureProjection> {
  const [txRes, recurring, accounts] = await Promise.all([
    db
      .prepare(
        `SELECT id, type, amount, currency, account_id, description, installments_total, first_installment_month, third_party_name
         FROM transactions
         WHERE installments_total IS NOT NULL AND installments_total >= 1 AND currency = 'ARS'`
      )
      .all<
        Pick<
          Transaction,
          | 'id'
          | 'type'
          | 'amount'
          | 'currency'
          | 'account_id'
          | 'description'
          | 'installments_total'
          | 'first_installment_month'
          | 'third_party_name'
        >
      >(),
    listRecurringItems(db),
    listAccountsWithBalances(db),
  ]);

  const reservas = accounts.find((a) => a.id === 'mp_reservas')?.balance ?? 0;
  return computeFutureProjection(txRes.results ?? [], recurring, reservas, startMonth, monthsAhead);
}
