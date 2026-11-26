import type {
  Account,
  AccountInput,
  AccountPatch,
  AccountType,
  AccountWithBalance,
  AccountingBasis,
  CardStatement,
  CardStatementItem,
  Category,
  CategoryBreakdown,
  CategoryInput,
  CategoryPatch,
  FutureProjection,
  MonthProjection,
  MonthSummary,
  MonthlyHistoryPoint,
  PayStatementInput,
  ProjectedInstallment,
  RecurringItem,
  RecurringItemInput,
  SharedPurchaseInput,
  Tag,
  TagBreakdown,
  TagPatch,
  ThirdPartyBalance,
  Transaction,
  TransactionInput,
  TransactionType,
} from './types';
import {
  addMonths,
  defaultColorForAccountType,
  getMonthDateRange,
  monthDiff,
  previousMonths,
  shortId,
  slugifyId,
  slugifyTag,
} from './utils';

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export function pickDefaultLiquidAccount<
  T extends Pick<Account, 'id' | 'type' | 'currency' | 'is_default'>,
>(accounts: T[], preferredCurrency?: string): T | null {
  const liquid = accounts.filter((a) => a.type !== 'credit_card');
  if (liquid.length === 0) return null;

  if (preferredCurrency) {
    const exactDefault = liquid.find(
      (a) => a.is_default === 1 && a.currency === preferredCurrency
    );
    if (exactDefault) return exactDefault;
    const exactAny = liquid.find((a) => a.currency === preferredCurrency);
    if (exactAny) return exactAny;
  }

  return liquid.find((a) => a.is_default === 1) ?? liquid[0];
}

export function computeSavingsBalance(
  accounts: Pick<AccountWithBalance, 'type' | 'currency' | 'balance'>[],
  currency = 'ARS'
): number {
  const total = accounts
    .filter((a) => a.type === 'savings' && a.currency === currency)
    .reduce((sum, a) => sum + a.balance, 0);
  return round2(total);
}

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

export function computeCardStatements(
  accounts: Account[],
  transactions: Transaction[],
  statementMonth: string
): CardStatement[] {
  const balances = computeAccountBalances(accounts, transactions);
  const balanceMap = new Map(balances.map((a) => [a.id, a.balance]));
  const cardAccounts = accounts.filter((a) => a.type === 'credit_card');

  return cardAccounts.map((card) => {
    const items: CardStatementItem[] = [];

    for (const tx of transactions) {
      if (tx.account_id !== card.id) continue;
      if (tx.type !== 'expense' && tx.type !== 'third_party') continue;

      if (tx.installments_total && tx.installments_total >= 2) {
        const firstMonth =
          tx.first_installment_month && /^\d{4}-\d{2}$/.test(tx.first_installment_month)
            ? tx.first_installment_month
            : addMonths(tx.occurred_at.slice(0, 7), 1);
        const idx = monthDiff(firstMonth, statementMonth);
        if (idx >= 0 && idx < tx.installments_total) {
          items.push({
            transaction_id: tx.id,
            description: tx.description,
            type: tx.type,
            category_id: tx.category_id,
            tags: tx.tags,
            installment_number: idx + 1,
            installments_total: tx.installments_total,
            installment_amount: round2(tx.amount / tx.installments_total),
            third_party_name: tx.third_party_name,
            occurred_at: tx.occurred_at,
          });
        }
      } else {
        const dueMonth =
          tx.statement_month && /^\d{4}-\d{2}$/.test(tx.statement_month)
            ? tx.statement_month
            : tx.first_installment_month && /^\d{4}-\d{2}$/.test(tx.first_installment_month)
              ? tx.first_installment_month
              : addMonths(tx.occurred_at.slice(0, 7), 1);

        if (dueMonth === statementMonth) {
          items.push({
            transaction_id: tx.id,
            description: tx.description,
            type: tx.type,
            category_id: tx.category_id,
            tags: tx.tags,
            installment_number: 1,
            installments_total: 1,
            installment_amount: round2(tx.amount),
            third_party_name: tx.third_party_name,
            occurred_at: tx.occurred_at,
          });
        }
      }
    }

    const ownTotal = round2(
      items.filter((i) => i.type === 'expense').reduce((s, i) => s + i.installment_amount, 0)
    );
    const thirdPartyTotal = round2(
      items.filter((i) => i.type === 'third_party').reduce((s, i) => s + i.installment_amount, 0)
    );
    const totalDue = round2(ownTotal + thirdPartyTotal);

    const paymentTx = transactions.find(
      (t) =>
        t.type === 'transfer' &&
        t.to_account_id === card.id &&
        t.statement_month === statementMonth
    );

    return {
      account_id: card.id,
      account_name: card.name,
      currency: card.currency,
      card_debt: balanceMap.get(card.id) ?? 0,
      statement_month: statementMonth,
      total_due: totalDue,
      own_total: ownTotal,
      third_party_total: thirdPartyTotal,
      status: paymentTx ? 'paid' : 'pending',
      paid_transaction_id: paymentTx?.id ?? null,
      paid_at: paymentTx?.occurred_at ?? null,
      paid_amount: paymentTx ? paymentTx.amount : null,
      items,
    };
  });
}

export function computePeriodMetrics(
  accounts: Account[],
  transactions: Transaction[],
  categories: Category[],
  tags: Tag[],
  options: { from: string; to: string; basis: AccountingBasis; statementMonth?: string }
): MonthSummary {
  const { from, to, basis } = options;
  const statementMonth = options.statementMonth ?? to.slice(0, 7);
  const cardAccountIds = new Set(accounts.filter((a) => a.type === 'credit_card').map((a) => a.id));
  const statementCache = new Map<string, CardStatement[]>();

  const getCardStatement = (cardId: string, month: string): CardStatement | undefined => {
    let list = statementCache.get(month);
    if (!list) {
      list = computeCardStatements(accounts, transactions, month);
      statementCache.set(month, list);
    }
    return list.find((s) => s.account_id === cardId);
  };

  let income = 0;
  let expense = 0;
  let cardPurchases = 0;
  let cardPurchasesUsd = 0;
  let investment = 0;
  let usdExpense = 0;
  const catTotals = new Map<string, number>();
  const tagTotals = new Map<string, number>();

  for (const tx of transactions) {
    if (tx.occurred_at < from || tx.occurred_at > to) continue;

    if (tx.type === 'income') {
      if (tx.currency === 'ARS') income += tx.amount;
    } else if (tx.type === 'investment') {
      if (tx.currency === 'ARS') investment += tx.amount;
    } else if (tx.type === 'expense') {
      const isCard = cardAccountIds.has(tx.account_id);
      if (isCard) {
        if (tx.currency === 'ARS') cardPurchases += tx.amount;
        else if (tx.currency === 'USD') cardPurchasesUsd += tx.amount;
      }
      if (basis === 'cash' && isCard) {
        continue;
      }
      if (tx.currency === 'USD') {
        usdExpense += tx.amount;
      } else if (tx.currency === 'ARS') {
        expense += tx.amount;
        const catId = tx.category_id ?? 'otros';
        catTotals.set(catId, (catTotals.get(catId) ?? 0) + tx.amount);
        for (const tagId of tx.tags) {
          tagTotals.set(tagId, (tagTotals.get(tagId) ?? 0) + tx.amount);
        }
      }
    } else if (
      basis === 'cash' &&
      tx.type === 'transfer' &&
      tx.to_account_id &&
      cardAccountIds.has(tx.to_account_id)
    ) {
      if (tx.currency === 'USD') {
        usdExpense += tx.amount;
        continue;
      }
      if (tx.currency !== 'ARS') continue;

      if (tx.statement_month) {
        const statement = getCardStatement(tx.to_account_id, tx.statement_month);
        if (statement && statement.items.length > 0) {
          const ownItems = statement.items.filter((i) => i.type === 'expense');
          const ownSum = round2(ownItems.reduce((s, i) => s + i.installment_amount, 0));
          const thirdSum = statement.third_party_total;
          const availableForOwn = Math.max(0, round2(tx.amount - thirdSum));
          const countedOwn = Math.min(ownSum, availableForOwn);
          const scale = ownSum > 0 ? countedOwn / ownSum : 0;

          for (const item of ownItems) {
            const portion = round2(item.installment_amount * scale);
            if (portion <= 0) continue;
            expense += portion;
            const catId = item.category_id ?? 'otros';
            catTotals.set(catId, (catTotals.get(catId) ?? 0) + portion);
            for (const tagId of item.tags) {
              tagTotals.set(tagId, (tagTotals.get(tagId) ?? 0) + portion);
            }
          }

          const extra = round2(availableForOwn - ownSum);
          if (extra > 0.01) {
            expense += extra;
            catTotals.set('otros', (catTotals.get('otros') ?? 0) + extra);
          }
        } else {
          expense += tx.amount;
          catTotals.set('otros', (catTotals.get('otros') ?? 0) + tx.amount);
        }
      } else {
        expense += tx.amount;
        catTotals.set('otros', (catTotals.get('otros') ?? 0) + tx.amount);
      }
    }
  }

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const byCategory: CategoryBreakdown[] = Array.from(catTotals.entries())
    .map(([categoryId, total]) => {
      const cat = catMap.get(categoryId);
      return {
        category_id: categoryId,
        name: cat?.name ?? 'Otros / Trámites',
        icon: cat?.icon ?? '📦',
        color: cat?.color ?? '#9E9E9E',
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

  const thirdParty = computeThirdPartyBalances(transactions);
  const accountsWithBalances = computeAccountBalances(accounts, transactions);
  const cardStatements = computeCardStatements(accounts, transactions, statementMonth);

  return {
    month: from.slice(0, 7),
    from,
    to,
    basis,
    income: round2(income),
    expense: round2(expense),
    card_purchases: round2(cardPurchases),
    card_purchases_usd: round2(cardPurchasesUsd),
    investment: round2(investment),
    net: round2(income - expense),
    net_after_investment: round2(income - expense - investment),
    usd_expense: round2(usdExpense),
    by_category: byCategory,
    by_tag: byTag,
    third_party_pending: thirdParty.total_pending,
    third_party_by_person: thirdParty.by_person,
    accounts: accountsWithBalances,
    card_statements: cardStatements,
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

  if (rows.length > 80) {
    const res = await db
      .prepare('SELECT transaction_id, tag_id FROM transaction_tags ORDER BY tag_id ASC')
      .all<{ transaction_id: string; tag_id: string }>();
    for (const rel of res.results ?? []) {
      const list = tagMap.get(rel.transaction_id) ?? [];
      list.push(rel.tag_id);
      tagMap.set(rel.transaction_id, list);
    }
  } else {
    const placeholders = rows.map(() => '?').join(', ');
    const res = await db
      .prepare(
        `SELECT transaction_id, tag_id FROM transaction_tags WHERE transaction_id IN (${placeholders}) ORDER BY tag_id ASC`
      )
      .bind(...rows.map((r) => r.id))
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

async function loadAllDataForAnalysis(db: D1Database): Promise<{
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  transactions: Transaction[];
}> {
  const [accRes, txRes, categories, tags] = await Promise.all([
    db.prepare('SELECT * FROM accounts ORDER BY is_default DESC, name ASC').all<Account>(),
    db.prepare('SELECT * FROM transactions ORDER BY occurred_at DESC, created_at DESC').all<RawTransactionRow>(),
    listCategories(db),
    listTags(db),
  ]);
  const transactions = await hydrateTransactionTags(db, txRes.results ?? []);
  return {
    accounts: accRes.results ?? [],
    categories,
    tags,
    transactions,
  };
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

const VALID_ACCOUNT_TYPES = new Set<AccountType>(['wallet', 'savings', 'credit_card', 'cash']);

async function generateUniqueId(
  db: D1Database,
  table: 'accounts' | 'categories',
  name: string,
  explicitId?: string
): Promise<string> {
  const base = slugifyId(explicitId || name);
  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(candidate).first();
    if (!existing) return candidate;
    candidate = `${base}_${suffix}`;
    suffix++;
  }
}

export async function listAccountsWithBalances(db: D1Database): Promise<AccountWithBalance[]> {
  const [accRes, txRes] = await Promise.all([
    db.prepare('SELECT * FROM accounts ORDER BY is_default DESC, created_at ASC, name ASC').all<Account>(),
    db
      .prepare('SELECT type, amount, account_id, to_account_id FROM transactions')
      .all<Pick<Transaction, 'type' | 'amount' | 'account_id' | 'to_account_id'>>(),
  ]);

  return computeAccountBalances(accRes.results ?? [], txRes.results ?? []);
}

export async function createAccount(db: D1Database, input: AccountInput): Promise<AccountWithBalance> {
  if (!VALID_ACCOUNT_TYPES.has(input.type)) {
    throw new Error('Tipo de cuenta inválido');
  }
  const cleanName = input.name.trim().slice(0, 60);
  if (!cleanName) {
    throw new Error('El nombre de la cuenta es obligatorio');
  }

  const id = await generateUniqueId(db, 'accounts', cleanName, input.id);
  const currency = (input.currency || 'ARS').trim().toUpperCase().slice(0, 6) || 'ARS';
  const initialBalance =
    typeof input.initial_balance === 'number' && Number.isFinite(input.initial_balance)
      ? round2(input.initial_balance)
      : 0;
  const color = input.color?.trim() || defaultColorForAccountType(input.type);
  const createdAt = new Date().toISOString();

  let isDefault = input.type === 'credit_card' ? 0 : input.is_default ? 1 : 0;
  if (input.type !== 'credit_card' && isDefault === 0) {
    const existingDefault = await db
      .prepare("SELECT id FROM accounts WHERE type != 'credit_card' AND is_default = 1 LIMIT 1")
      .first();
    if (!existingDefault) {
      isDefault = 1;
    }
  }

  if (isDefault === 1) {
    await db.prepare('UPDATE accounts SET is_default = 0').run();
  }

  await db
    .prepare(
      `INSERT INTO accounts (id, name, type, currency, initial_balance, color, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, cleanName, input.type, currency, initialBalance, color, isDefault, createdAt)
    .run();

  const accounts = await listAccountsWithBalances(db);
  const created = accounts.find((a) => a.id === id);
  if (!created) throw new Error('No se pudo recuperar la cuenta creada');
  return created;
}

export async function updateAccount(
  db: D1Database,
  id: string,
  patch: AccountPatch
): Promise<AccountWithBalance | null> {
  const existing = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<Account>();
  if (!existing) return null;

  const nextName = patch.name !== undefined ? patch.name.trim().slice(0, 60) : existing.name;
  if (!nextName) {
    throw new Error('El nombre de la cuenta no puede quedar vacío');
  }

  const nextType = patch.type ?? existing.type;
  if (!VALID_ACCOUNT_TYPES.has(nextType)) {
    throw new Error('Tipo de cuenta inválido');
  }

  const nextCurrency =
    patch.currency !== undefined
      ? patch.currency.trim().toUpperCase().slice(0, 6) || existing.currency
      : existing.currency;

  if (nextCurrency !== existing.currency) {
    const refTx = await db
      .prepare('SELECT COUNT(*) AS cnt FROM transactions WHERE account_id = ? OR to_account_id = ?')
      .bind(id, id)
      .first<{ cnt: number }>();
    if ((refTx?.cnt ?? 0) > 0) {
      throw new ConflictError(
        'No se puede cambiar la moneda de una cuenta que ya tiene movimientos registrados.'
      );
    }
  }

  const nextInitial =
    patch.initial_balance !== undefined && Number.isFinite(patch.initial_balance)
      ? round2(patch.initial_balance)
      : existing.initial_balance;
  const nextColor = patch.color !== undefined ? patch.color.trim() || existing.color : existing.color;

  let nextIsDefault =
    nextType === 'credit_card'
      ? 0
      : patch.is_default !== undefined
        ? patch.is_default
          ? 1
          : 0
        : existing.is_default;

  if (nextIsDefault === 1) {
    await db.prepare('UPDATE accounts SET is_default = 0 WHERE id != ?').bind(id).run();
  }

  await db
    .prepare(
      `UPDATE accounts
       SET name = ?, type = ?, currency = ?, initial_balance = ?, color = ?, is_default = ?
       WHERE id = ?`
    )
    .bind(nextName, nextType, nextCurrency, nextInitial, nextColor, nextIsDefault, id)
    .run();

  if (existing.is_default === 1 && nextIsDefault === 0) {
    const fallback = await db
      .prepare("SELECT id FROM accounts WHERE type != 'credit_card' AND id != ? ORDER BY created_at ASC LIMIT 1")
      .bind(id)
      .first<{ id: string }>();
    if (fallback) {
      await db.prepare('UPDATE accounts SET is_default = 1 WHERE id = ?').bind(fallback.id).run();
    }
  }

  const accounts = await listAccountsWithBalances(db);
  return accounts.find((a) => a.id === id) ?? null;
}

export async function deleteAccount(db: D1Database, id: string): Promise<boolean> {
  const existing = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<Account>();
  if (!existing) return false;

  const [txRefs, recRefs] = await Promise.all([
    db
      .prepare('SELECT COUNT(*) AS cnt FROM transactions WHERE account_id = ? OR to_account_id = ?')
      .bind(id, id)
      .first<{ cnt: number }>(),
    db
      .prepare('SELECT COUNT(*) AS cnt FROM recurring_items WHERE account_id = ?')
      .bind(id)
      .first<{ cnt: number }>(),
  ]);

  const txCount = txRefs?.cnt ?? 0;
  const recCount = recRefs?.cnt ?? 0;
  if (txCount > 0 || recCount > 0) {
    throw new ConflictError(
      `No se puede eliminar "${existing.name}" porque tiene ${txCount} movimientos y ${recCount} gastos fijos vinculados.`
    );
  }

  await db.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();

  if (existing.is_default === 1) {
    const fallback = await db
      .prepare("SELECT id FROM accounts WHERE type != 'credit_card' ORDER BY created_at ASC LIMIT 1")
      .first<{ id: string }>();
    if (fallback) {
      await db.prepare('UPDATE accounts SET is_default = 1 WHERE id = ?').bind(fallback.id).run();
    }
  }

  return true;
}

export async function updateAccountInitialBalance(
  db: D1Database,
  accountId: string,
  initialBalance: number
): Promise<Account | null> {
  return updateAccount(db, accountId, { initial_balance: initialBalance });
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

export async function payCardStatement(
  db: D1Database,
  input: PayStatementInput
): Promise<{
  transfer: Transaction;
  feesTx: Transaction | null;
  accounts: AccountWithBalance[];
  cardStatements: CardStatement[];
}> {
  const allAccounts = await listAccountsWithBalances(db);
  const card = allAccounts.find((a) => a.id === input.card_account_id && a.type === 'credit_card');
  if (!card) {
    throw new Error('Tarjeta no encontrada');
  }

  const fromAcc =
    (input.from_account_id
      ? allAccounts.find((a) => a.id === input.from_account_id && a.type !== 'credit_card')
      : null) ?? pickDefaultLiquidAccount(allAccounts, card.currency);

  if (!fromAcc) {
    throw new Error('Creá al menos una cuenta líquida antes de registrar el pago del resumen.');
  }

  let feesTx: Transaction | null = null;
  const feesAmount = input.fees_amount && input.fees_amount > 0 ? round2(input.fees_amount) : 0;

  if (feesAmount > 0) {
    feesTx = await createTransaction(db, {
      type: 'expense',
      amount: feesAmount,
      currency: card.currency,
      account_id: card.id,
      category_id: 'otros',
      description: `Sellos e impuestos resumen ${input.statement_month}`,
      occurred_at: input.occurred_at,
      statement_month: input.statement_month,
      source: 'web_statement_pay',
    });
  }

  const totalPaid = round2(input.amount + feesAmount);
  const transfer = await createTransaction(db, {
    type: 'transfer',
    amount: totalPaid,
    currency: card.currency,
    account_id: fromAcc.id,
    to_account_id: card.id,
    description:
      input.description?.trim() || `Pago resumen ${card.name} ${input.statement_month}`,
    occurred_at: input.occurred_at,
    statement_month: input.statement_month,
    source: 'web_statement_pay',
  });

  const { accounts, transactions } = await loadAllDataForAnalysis(db);
  return {
    transfer,
    feesTx,
    accounts: computeAccountBalances(accounts, transactions),
    cardStatements: computeCardStatements(accounts, transactions, input.statement_month),
  };
}

export async function listCategories(db: D1Database): Promise<Category[]> {
  const res = await db.prepare('SELECT * FROM categories ORDER BY type ASC, name ASC').all<Category>();
  return res.results ?? [];
}

export async function createCategory(db: D1Database, input: CategoryInput): Promise<Category> {
  const cleanName = input.name.trim().slice(0, 60);
  if (!cleanName) throw new Error('Nombre de categoría obligatorio');
  const id = await generateUniqueId(db, 'categories', cleanName, input.id);
  const icon = input.icon.trim() || '📦';
  const color = input.color.trim() || '#9E9E9E';
  const type = input.type === 'income' || input.type === 'both' ? input.type : 'expense';

  await db
    .prepare('INSERT INTO categories (id, name, icon, type, color) VALUES (?, ?, ?, ?, ?)')
    .bind(id, cleanName, icon, type, color)
    .run();

  const row = await db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first<Category>();
  if (!row) throw new Error('No se pudo crear la categoría');
  return row;
}

export async function updateCategory(
  db: D1Database,
  id: string,
  patch: CategoryPatch
): Promise<Category | null> {
  const existing = await db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first<Category>();
  if (!existing) return null;

  const nextName = patch.name !== undefined ? patch.name.trim().slice(0, 60) : existing.name;
  if (!nextName) throw new Error('Nombre de categoría inválido');
  const nextIcon = patch.icon !== undefined ? patch.icon.trim() || existing.icon : existing.icon;
  const nextColor = patch.color !== undefined ? patch.color.trim() || existing.color : existing.color;
  const nextType = patch.type ?? existing.type;

  await db
    .prepare('UPDATE categories SET name = ?, icon = ?, type = ?, color = ? WHERE id = ?')
    .bind(nextName, nextIcon, nextType, nextColor, id)
    .run();

  return db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first<Category>();
}

export async function deleteCategory(db: D1Database, id: string): Promise<boolean> {
  const existing = await db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first<Category>();
  if (!existing) return false;

  const [txRefs, recRefs] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS cnt FROM transactions WHERE category_id = ?').bind(id).first<{ cnt: number }>(),
    db.prepare('SELECT COUNT(*) AS cnt FROM recurring_items WHERE category_id = ?').bind(id).first<{ cnt: number }>(),
  ]);

  const txCount = txRefs?.cnt ?? 0;
  const recCount = recRefs?.cnt ?? 0;
  if (txCount > 0 || recCount > 0) {
    throw new ConflictError(
      `No se puede eliminar "${existing.name}" porque tiene ${txCount} movimientos y ${recCount} gastos fijos vinculados.`
    );
  }

  await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return true;
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

export async function updateTag(db: D1Database, id: string, patch: TagPatch): Promise<Tag | null> {
  const existing = await db.prepare('SELECT * FROM tags WHERE id = ?').bind(id).first<Tag>();
  if (!existing) return null;

  const nextName =
    patch.name !== undefined ? patch.name.trim().replace(/^#/, '') || existing.name : existing.name;
  const nextColor = patch.color !== undefined ? patch.color.trim() || existing.color : existing.color;

  await db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').bind(nextName, nextColor, id).run();
  return db.prepare('SELECT * FROM tags WHERE id = ?').bind(id).first<Tag>();
}

export async function deleteTag(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
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
        installments_total, first_installment_month, statement_month, third_party_name, linked_group_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      input.statement_month ?? null,
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
      | 'statement_month'
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
  const nextStatementMonth =
    patch.statement_month !== undefined ? patch.statement_month : existing.statement_month;
  const nextThirdPartyName =
    patch.third_party_name !== undefined ? patch.third_party_name : existing.third_party_name;

  await db
    .prepare(
      `UPDATE transactions
       SET type = ?, amount = ?, currency = ?, account_id = ?, to_account_id = ?,
           category_id = ?, description = ?, occurred_at = ?,
           installments_total = ?, first_installment_month = ?, statement_month = ?, third_party_name = ?
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
      nextStatementMonth,
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
  from?: string;
  to?: string;
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

  if (filters.from && filters.to) {
    conditions.push('t.occurred_at >= ? AND t.occurred_at <= ?');
    bindings.push(filters.from, filters.to);
  } else if (filters.month) {
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
  const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 2500) : 300;

  const sql = `SELECT t.* FROM transactions t ${where} ORDER BY t.occurred_at DESC, t.created_at DESC LIMIT ?`;
  bindings.push(limit);

  const res = await db.prepare(sql).bind(...bindings).all<RawTransactionRow>();
  return hydrateTransactionTags(db, res.results ?? []);
}

export async function getPeriodSummary(
  db: D1Database,
  options: {
    from: string;
    to: string;
    basis?: AccountingBasis;
    statementMonth?: string;
  }
): Promise<MonthSummary> {
  const { accounts, categories, tags, transactions } = await loadAllDataForAnalysis(db);
  return computePeriodMetrics(accounts, transactions, categories, tags, {
    from: options.from,
    to: options.to,
    basis: options.basis ?? 'cash',
    statementMonth: options.statementMonth,
  });
}

export async function getMonthSummary(
  db: D1Database,
  month: string,
  basis: AccountingBasis = 'cash'
): Promise<MonthSummary> {
  const { start, end } = getMonthDateRange(month);
  return getPeriodSummary(db, { from: start, to: end, basis, statementMonth: month });
}

export async function getMonthlyHistory(
  db: D1Database,
  options: { from: string; to: string; basis?: AccountingBasis }
): Promise<MonthlyHistoryPoint[]> {
  const { accounts, categories, tags, transactions } = await loadAllDataForAnalysis(db);
  const basis = options.basis ?? 'cash';

  const fromYm = options.from.slice(0, 7);
  const toYm = options.to.slice(0, 7);
  const diff = monthDiff(fromYm, toYm);

  let months: string[];
  if (diff <= 0) {
    months = previousMonths(toYm, 6);
  } else {
    const count = Math.min(diff + 1, 24);
    const startYm = addMonths(toYm, -(count - 1));
    months = [];
    for (let i = 0; i < count; i++) {
      months.push(addMonths(startYm, i));
    }
  }

  return months.map((m) => {
    const { start, end } = getMonthDateRange(m);
    const summary = computePeriodMetrics(accounts, transactions, categories, tags, {
      from: start,
      to: end,
      basis,
      statementMonth: m,
    });
    return {
      month: m,
      income: summary.income,
      expense: summary.expense,
    };
  });
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
  monthsAhead = 3,
  currency = 'ARS'
): Promise<FutureProjection> {
  const [txRes, recurring, accounts] = await Promise.all([
    db
      .prepare(
        `SELECT id, type, amount, currency, account_id, description, installments_total, first_installment_month, third_party_name
         FROM transactions
         WHERE installments_total IS NOT NULL AND installments_total >= 1 AND currency = ?`
      )
      .bind(currency)
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

  const reservas = computeSavingsBalance(accounts, currency);
  return computeFutureProjection(txRes.results ?? [], recurring, reservas, startMonth, monthsAhead);
}
