import {
  SUPPORTED_CURRENCIES,
  type Account,
  type AccountInput,
  type AccountPatch,
  type AccountType,
  type AccountWithBalance,
  type AccountingBasis,
  type CardStatement,
  type CardStatementItem,
  type CardStatementRecurringItem,
  type Category,
  type CategoryBreakdown,
  type CategoryInput,
  type CategoryPatch,
  type CategoryType,
  type FutureProjection,
  type MonthProjection,
  type MonthSummary,
  type MonthlyHistoryPoint,
  type OverdueCardAlert,
  type PaidStatementItem,
  type PayStatementInput,
  type ProjectedInstallment,
  type RecurringItem,
  type RecurringItemInput,
  type SharedPurchaseInput,
  type Tag,
  type TagBreakdown,
  type TagPatch,
  type ThirdPartyBalance,
  type Transaction,
  type TransactionInput,
  type TransactionType,
} from './types';
import {
  addMonths,
  defaultColorForAccountType,
  getMonthDateRange,
  isValidIsoDate,
  isValidYearMonth,
  monthDiff,
  normalizeCurrency,
  previousMonths,
  shortId,
  slugifyId,
  slugifyTag,
  todayInTimezone,
} from './utils';

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

const VALID_TX_TYPES = new Set<TransactionType>([
  'expense',
  'income',
  'transfer',
  'investment',
  'third_party',
  'third_party_repayment',
  'adjustment',
]);

const VALID_CATEGORY_TYPES = new Set<CategoryType>(['expense', 'income', 'both']);

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

function normalizeMonth(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isValidYearMonth(trimmed) ? trimmed : null;
}

function normalizeTextForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDueDay(value: number | null | undefined, type: AccountType): number | null {
  if (type !== 'credit_card') return null;
  if (value === null || value === undefined) return null;
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null;
}

function resolveDayInMonth(ym: string, day: number): string {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return `${ym}-${String(clamped).padStart(2, '0')}`;
}

export function computeAccountBalances(
  accounts: Account[],
  transactions: (Pick<Transaction, 'type' | 'amount' | 'account_id' | 'to_account_id'> & {
    currency?: string;
  })[]
): AccountWithBalance[] {
  const map = new Map<string, number>();
  const currencyMap = new Map<string, string>();
  for (const acc of accounts) {
    map.set(acc.id, acc.initial_balance);
    currencyMap.set(acc.id, acc.currency);
  }

  for (const tx of transactions) {
    const srcCurrency = currencyMap.get(tx.account_id);
    const matchesSrc =
      srcCurrency !== undefined && (tx.currency === undefined || tx.currency === srcCurrency);

    if (tx.type === 'income' || tx.type === 'third_party_repayment' || tx.type === 'adjustment') {
      if (matchesSrc) {
        map.set(tx.account_id, (map.get(tx.account_id) ?? 0) + tx.amount);
      }
    } else if (tx.type === 'expense' || tx.type === 'investment' || tx.type === 'third_party') {
      if (matchesSrc) {
        map.set(tx.account_id, (map.get(tx.account_id) ?? 0) - tx.amount);
      }
    } else if (tx.type === 'transfer') {
      if (matchesSrc) {
        map.set(tx.account_id, (map.get(tx.account_id) ?? 0) - tx.amount);
      }
      if (tx.to_account_id) {
        const dstCurrency = currencyMap.get(tx.to_account_id);
        const matchesDst =
          dstCurrency !== undefined && (tx.currency === undefined || tx.currency === dstCurrency);
        if (matchesDst) {
          map.set(tx.to_account_id, (map.get(tx.to_account_id) ?? 0) + tx.amount);
        }
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

export function effectiveTransactionDate(
  tx: Pick<Transaction, 'occurred_at' | 'budget_month'>
): string {
  if (tx.budget_month && isValidYearMonth(tx.budget_month)) {
    return `${tx.budget_month}-01`;
  }
  return tx.occurred_at;
}

function extractCardStatementItems(
  cardId: string,
  cardCurrency: string,
  transactions: Transaction[],
  statementMonth: string
): CardStatementItem[] {
  const items: CardStatementItem[] = [];

  for (const tx of transactions) {
    if (tx.account_id !== cardId || tx.currency !== cardCurrency) continue;
    if (tx.type !== 'expense' && tx.type !== 'third_party') continue;

    if (tx.installments_total && tx.installments_total >= 2) {
      const firstMonth =
        normalizeMonth(tx.first_installment_month) ?? addMonths(tx.occurred_at.slice(0, 7), 1);
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
        normalizeMonth(tx.statement_month) ??
        normalizeMonth(tx.first_installment_month) ??
        addMonths(tx.occurred_at.slice(0, 7), 1);

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

  return items;
}

export function computeCardStatements(
  accounts: Account[],
  transactions: Transaction[],
  statementMonth: string,
  recurringItems: RecurringItem[] = [],
  today?: string
): CardStatement[] {
  const balances = computeAccountBalances(accounts, transactions);
  const balanceMap = new Map(balances.map((a) => [a.id, a.balance]));
  const cardAccounts = accounts.filter((a) => a.type === 'credit_card');
  const todayDate = today ?? todayInTimezone();

  return cardAccounts.map((card) => {
    const items = extractCardStatementItems(card.id, card.currency, transactions, statementMonth);

    const ownTotal = round2(
      items.filter((i) => i.type === 'expense').reduce((s, i) => s + i.installment_amount, 0)
    );
    const thirdPartyTotal = round2(
      items.filter((i) => i.type === 'third_party').reduce((s, i) => s + i.installment_amount, 0)
    );
    const totalDue = round2(ownTotal + thirdPartyTotal);

    const paymentTxs = transactions.filter(
      (t) =>
        t.type === 'transfer' &&
        t.to_account_id === card.id &&
        t.statement_month === statementMonth &&
        t.currency === card.currency
    );
    const paidAmountSum = round2(paymentTxs.reduce((s, t) => s + t.amount, 0));
    const remainingDue = Math.max(0, round2(totalDue - paidAmountSum));
    const isFullyPaid =
      paymentTxs.length > 0 && (totalDue <= 0 || paidAmountSum >= totalDue - 0.01);

    const cardRecurring = recurringItems
      .filter((r) => {
        if (r.active !== 1 || r.type !== 'expense' || r.account_id !== card.id) return false;
        const startMonth = normalizeMonth(r.start_month);
        if (startMonth && statementMonth < startMonth) {
          return false;
        }
        return true;
      })
      .map((r): CardStatementRecurringItem => {
        const needle = normalizeTextForMatch(r.name);
        const tokenRegex =
          needle.length > 0
            ? new RegExp(`(?:^|[^a-z0-9])${escapeRegex(needle)}(?:$|[^a-z0-9])`)
            : null;
        const matchedTx =
          needle.length > 0
            ? transactions.find((tx) => {
                if (tx.account_id !== card.id || tx.type !== 'expense') return false;
                if (tx.currency !== r.currency) return false;
                if (tx.installments_total && tx.installments_total >= 2) return false;
                const descNorm = normalizeTextForMatch(tx.description);
                if (descNorm !== needle && !(tokenRegex && tokenRegex.test(descNorm))) {
                  return false;
                }
                const dueMonth =
                  normalizeMonth(tx.statement_month) ??
                  normalizeMonth(tx.first_installment_month) ??
                  addMonths(tx.occurred_at.slice(0, 7), 1);
                return dueMonth === statementMonth;
              })
            : undefined;
        return {
          recurring_id: r.id,
          name: r.name,
          amount: r.amount,
          currency: r.currency,
          category_id: r.category_id,
          day_of_month: r.day_of_month,
          start_month: r.start_month ?? null,
          posted_transaction_id: matchedTx?.id ?? null,
        };
      });

    const dueDay =
      card.due_day && Number.isInteger(card.due_day) && card.due_day >= 1 && card.due_day <= 31
        ? card.due_day
        : null;
    const dueDate = dueDay ? resolveDayInMonth(statementMonth, dueDay) : null;
    const isOverdue = !isFullyPaid && totalDue > 0 && dueDate !== null && todayDate > dueDate;

    return {
      account_id: card.id,
      account_name: card.name,
      currency: card.currency,
      card_debt: balanceMap.get(card.id) ?? 0,
      statement_month: statementMonth,
      due_day: dueDay,
      due_date: dueDate,
      is_overdue: isOverdue,
      total_due: totalDue,
      own_total: ownTotal,
      third_party_total: thirdPartyTotal,
      status: isFullyPaid ? 'paid' : paymentTxs.length > 0 ? 'partial' : 'pending',
      paid_transaction_id: paymentTxs[0]?.id ?? null,
      paid_transaction_ids: paymentTxs.map((t) => t.id),
      paid_at: paymentTxs[0]?.occurred_at ?? null,
      paid_amount: paymentTxs.length > 0 ? paidAmountSum : null,
      remaining_due: remainingDue,
      items,
      recurring_items: cardRecurring,
    };
  });
}

export function computeOverdueCardAlerts(
  accounts: Account[],
  transactions: Transaction[],
  today?: string
): OverdueCardAlert[] {
  const dueCardIds = new Set(
    accounts
      .filter(
        (a) =>
          a.type === 'credit_card' &&
          a.due_day !== null &&
          a.due_day !== undefined &&
          Number.isInteger(a.due_day) &&
          a.due_day >= 1 &&
          a.due_day <= 31
      )
      .map((a) => a.id)
  );
  if (dueCardIds.size === 0) return [];

  const todayDate = today ?? todayInTimezone();
  const currentYm = todayDate.slice(0, 7);
  const candidateMonths = new Set<string>([currentYm]);

  for (const tx of transactions) {
    if (!dueCardIds.has(tx.account_id)) continue;
    if (tx.type !== 'expense' && tx.type !== 'third_party') continue;

    if (tx.installments_total && tx.installments_total >= 2) {
      const firstMonth =
        normalizeMonth(tx.first_installment_month) ?? addMonths(tx.occurred_at.slice(0, 7), 1);
      for (let i = 0; i < tx.installments_total; i++) {
        const m = addMonths(firstMonth, i);
        if (m <= currentYm) {
          candidateMonths.add(m);
        }
      }
    } else {
      const dueMonth =
        normalizeMonth(tx.statement_month) ??
        normalizeMonth(tx.first_installment_month) ??
        addMonths(tx.occurred_at.slice(0, 7), 1);
      if (dueMonth <= currentYm) {
        candidateMonths.add(dueMonth);
      }
    }
  }

  const alerts: OverdueCardAlert[] = [];
  for (const m of Array.from(candidateMonths).sort()) {
    const statements = computeCardStatements(accounts, transactions, m, [], todayDate);
    for (const st of statements) {
      if (st.is_overdue && st.due_date) {
        alerts.push({
          account_id: st.account_id,
          account_name: st.account_name,
          currency: st.currency,
          statement_month: st.statement_month,
          due_date: st.due_date,
          total_due: st.total_due,
        });
      }
    }
  }

  alerts.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.account_name.localeCompare(b.account_name));
  return alerts;
}

interface StatementAllocationState {
  thirdRemaining: number;
  ownRemaining: number;
  ownSum: number;
  ownItems: CardStatementItem[];
}

function processCardPaymentAllocations(
  cardAccountMap: Map<string, Account>,
  transactions: Transaction[],
  getItems: (cardId: string, cardCurrency: string, month: string) => CardStatementItem[],
  handlers: {
    onAllocated: (ctx: {
      tx: Transaction;
      effDate: string;
      card: Account;
      ownItems: CardStatementItem[];
      scale: number;
      countedOwn: number;
      extra: number;
    }) => void;
    onUnallocated: (ctx: { tx: Transaction; effDate: string; card: Account }) => void;
  },
  currencies?: ReadonlySet<string>
): void {
  const cardPaymentTransfers = transactions
    .filter((tx) => {
      if (tx.type !== 'transfer' || !tx.to_account_id) return false;
      const card = cardAccountMap.get(tx.to_account_id);
      if (!card || tx.currency !== card.currency) return false;
      if (currencies && !currencies.has(tx.currency)) return false;
      return tx.currency === 'ARS' || tx.currency === 'USD' || tx.currency === 'BRL';
    })
    .slice()
    .sort(
      (a, b) =>
        a.occurred_at.localeCompare(b.occurred_at) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id)
    );

  const allocStates = new Map<string, StatementAllocationState | null>();

  for (const tx of cardPaymentTransfers) {
    const effDate = effectiveTransactionDate(tx);
    const card = cardAccountMap.get(tx.to_account_id!)!;

    if (tx.statement_month) {
      const key = `${card.id}:${tx.statement_month}`;
      let state = allocStates.get(key);
      if (state === undefined) {
        const items = getItems(card.id, card.currency, tx.statement_month);
        if (items.length > 0) {
          const ownItems = items.filter((i) => i.type === 'expense');
          const ownSum = round2(ownItems.reduce((s, i) => s + i.installment_amount, 0));
          const thirdSum = round2(
            items.filter((i) => i.type === 'third_party').reduce((s, i) => s + i.installment_amount, 0)
          );
          state = {
            thirdRemaining: thirdSum,
            ownRemaining: ownSum,
            ownSum,
            ownItems,
          };
        } else {
          state = null;
        }
        allocStates.set(key, state);
      }

      if (state) {
        const thirdAbsorbed = Math.min(state.thirdRemaining, tx.amount);
        state.thirdRemaining = round2(state.thirdRemaining - thirdAbsorbed);
        const availableForOwn = round2(tx.amount - thirdAbsorbed);
        const countedOwn = Math.min(state.ownRemaining, availableForOwn);
        state.ownRemaining = round2(state.ownRemaining - countedOwn);
        const extra = round2(availableForOwn - countedOwn);
        const scale = state.ownSum > 0 ? countedOwn / state.ownSum : 0;

        handlers.onAllocated({
          tx,
          effDate,
          card,
          ownItems: state.ownItems,
          scale,
          countedOwn,
          extra,
        });
        continue;
      }
    }

    handlers.onUnallocated({ tx, effDate, card });
  }
}

export function computePeriodMetrics(
  accounts: Account[],
  transactions: Transaction[],
  categories: Category[],
  tags: Tag[],
  options: {
    from: string;
    to: string;
    basis: AccountingBasis;
    statementMonth?: string;
    recurringItems?: RecurringItem[];
    today?: string;
  }
): MonthSummary {
  const { from, to, basis } = options;
  const statementMonth = options.statementMonth ?? to.slice(0, 7);
  const recurringItems = options.recurringItems ?? [];
  const cardAccounts = accounts.filter((a) => a.type === 'credit_card');
  const cardAccountMap = new Map(cardAccounts.map((a) => [a.id, a]));
  const cardAccountIds = new Set(cardAccounts.map((a) => a.id));
  const itemCache = new Map<string, CardStatementItem[]>();
  const paidStatementItems: PaidStatementItem[] = [];

  const getItems = (cardId: string, cardCurrency: string, month: string): CardStatementItem[] => {
    const key = `${cardId}:${month}`;
    let cached = itemCache.get(key);
    if (!cached) {
      cached = extractCardStatementItems(cardId, cardCurrency, transactions, month);
      itemCache.set(key, cached);
    }
    return cached;
  };

  let income = 0;
  let expense = 0;
  let cardPurchases = 0;
  let cardPurchasesUsd = 0;
  let cardPurchasesBrl = 0;
  let investment = 0;
  let usdExpense = 0;
  let brlExpense = 0;
  const catTotals = new Map<string, number>();
  const tagTotals = new Map<string, number>();

  for (const tx of transactions) {
    const effDate = effectiveTransactionDate(tx);
    if (effDate < from || effDate > to) continue;

    if (tx.type === 'income') {
      if (tx.currency === 'ARS') income += tx.amount;
    } else if (tx.type === 'investment') {
      if (tx.currency === 'ARS') investment += tx.amount;
    } else if (tx.type === 'expense') {
      const isCard = cardAccountIds.has(tx.account_id);
      if (isCard) {
        if (tx.currency === 'ARS') cardPurchases += tx.amount;
        else if (tx.currency === 'USD') cardPurchasesUsd += tx.amount;
        else if (tx.currency === 'BRL') cardPurchasesBrl += tx.amount;
      }
      if (basis === 'cash' && isCard) {
        continue;
      }
      if (tx.currency === 'USD') {
        usdExpense += tx.amount;
      } else if (tx.currency === 'BRL') {
        brlExpense += tx.amount;
      } else if (tx.currency === 'ARS') {
        expense += tx.amount;
        const catId = tx.category_id ?? 'otros';
        catTotals.set(catId, (catTotals.get(catId) ?? 0) + tx.amount);
        for (const tagId of tx.tags) {
          tagTotals.set(tagId, (tagTotals.get(tagId) ?? 0) + tx.amount);
        }
      }
    }
  }

  if (basis === 'cash') {
    processCardPaymentAllocations(cardAccountMap, transactions, getItems, {
      onAllocated: ({ tx, effDate, card, ownItems, scale, countedOwn, extra }) => {
        if (effDate < from || effDate > to) return;

        if (tx.currency === 'USD') {
          usdExpense += round2(countedOwn + extra);
        } else if (tx.currency === 'BRL') {
          brlExpense += round2(countedOwn + extra);
        } else if (tx.currency === 'ARS') {
          if (scale > 0) {
            for (const item of ownItems) {
              const portion = round2(item.installment_amount * scale);
              if (portion <= 0) continue;
              expense += portion;
              const catId = item.category_id ?? 'otros';
              catTotals.set(catId, (catTotals.get(catId) ?? 0) + portion);
              for (const tagId of item.tags) {
                tagTotals.set(tagId, (tagTotals.get(tagId) ?? 0) + portion);
              }
              paidStatementItems.push({
                transaction_id: item.transaction_id,
                payment_transaction_id: tx.id,
                card_account_id: card.id,
                card_account_name: card.name,
                statement_month: tx.statement_month!,
                paid_at: tx.occurred_at,
                occurred_at: item.occurred_at,
                description: item.description,
                category_id: item.category_id,
                tags: [...item.tags],
                installment_number: item.installment_number,
                installments_total: item.installments_total,
                installment_amount: item.installment_amount,
                prorated_amount: portion,
                currency: tx.currency,
              });
            }
          }

          if (extra >= 0.01) {
            expense += extra;
            catTotals.set('otros', (catTotals.get('otros') ?? 0) + extra);
          }
        }
      },
      onUnallocated: ({ tx, effDate }) => {
        if (effDate < from || effDate > to) return;

        if (tx.currency === 'USD') {
          usdExpense += tx.amount;
        } else if (tx.currency === 'BRL') {
          brlExpense += tx.amount;
        } else if (tx.currency === 'ARS') {
          expense += tx.amount;
          catTotals.set('otros', (catTotals.get('otros') ?? 0) + tx.amount);
        }
      },
    });
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
  const cardStatements = computeCardStatements(
    accounts,
    transactions,
    statementMonth,
    recurringItems,
    options.today
  );
  const overdueCardAlerts = computeOverdueCardAlerts(accounts, transactions, options.today);

  return {
    month: from.slice(0, 7),
    from,
    to,
    basis,
    income: round2(income),
    expense: round2(expense),
    card_purchases: round2(cardPurchases),
    card_purchases_usd: round2(cardPurchasesUsd),
    card_purchases_brl: round2(cardPurchasesBrl),
    investment: round2(investment),
    net: round2(income - expense),
    net_after_investment: round2(income - expense - investment),
    usd_expense: round2(usdExpense),
    brl_expense: round2(brlExpense),
    by_category: byCategory,
    by_tag: byTag,
    third_party_pending: thirdParty.total_pending,
    third_party_by_person: thirdParty.by_person,
    accounts: accountsWithBalances,
    card_statements: cardStatements,
    overdue_card_alerts: overdueCardAlerts,
    paid_statement_items: paidStatementItems,
  };
}

export function computeMonthlyHistory(
  accounts: Account[],
  transactions: Transaction[],
  options: { from: string; to: string; basis?: AccountingBasis }
): MonthlyHistoryPoint[] {
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

  const buckets = new Map<string, { income: number; expense: number }>(
    months.map((m) => [m, { income: 0, expense: 0 }])
  );

  const cardAccounts = accounts.filter((a) => a.type === 'credit_card');
  const cardAccountMap = new Map(cardAccounts.map((a) => [a.id, a]));
  const cardAccountIds = new Set(cardAccounts.map((a) => a.id));

  for (const tx of transactions) {
    if (tx.currency !== 'ARS') continue;
    if (tx.type !== 'income' && tx.type !== 'expense') continue;
    const effMonth = effectiveTransactionDate(tx).slice(0, 7);
    const bucket = buckets.get(effMonth);
    if (!bucket) continue;

    if (tx.type === 'income') {
      bucket.income += tx.amount;
    } else if (tx.type === 'expense') {
      if (basis === 'cash' && cardAccountIds.has(tx.account_id)) continue;
      bucket.expense += tx.amount;
    }
  }

  if (basis === 'cash') {
    const itemCache = new Map<string, CardStatementItem[]>();
    const getItems = (cardId: string, cardCurrency: string, month: string): CardStatementItem[] => {
      const key = `${cardId}:${month}`;
      let cached = itemCache.get(key);
      if (!cached) {
        cached = extractCardStatementItems(cardId, cardCurrency, transactions, month);
        itemCache.set(key, cached);
      }
      return cached;
    };

    processCardPaymentAllocations(
      cardAccountMap,
      transactions,
      getItems,
      {
        onAllocated: ({ effDate, ownItems, scale, extra }) => {
          const bucket = buckets.get(effDate.slice(0, 7));
          if (!bucket) return;
          if (scale > 0) {
            for (const item of ownItems) {
              const portion = round2(item.installment_amount * scale);
              if (portion > 0) {
                bucket.expense += portion;
              }
            }
          }
          if (extra >= 0.01) {
            bucket.expense += extra;
          }
        },
        onUnallocated: ({ tx, effDate }) => {
          const bucket = buckets.get(effDate.slice(0, 7));
          if (!bucket) return;
          bucket.expense += tx.amount;
        },
      },
      new Set(['ARS'])
    );
  }

  return months.map((m) => {
    const bucket = buckets.get(m)!;
    return {
      month: m,
      income: round2(bucket.income),
      expense: round2(bucket.expense),
    };
  });
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
  const activeRecurringArs = recurringItems.filter(
    (item) => item.active === 1 && item.type === 'expense' && item.currency === 'ARS'
  );
  const activeRecurringUsd = recurringItems.filter(
    (item) => item.active === 1 && item.type === 'expense' && item.currency === 'USD'
  );
  const activeRecurringBrl = recurringItems.filter(
    (item) => item.active === 1 && item.type === 'expense' && item.currency === 'BRL'
  );

  const months: MonthProjection[] = [];
  for (let i = 0; i < monthsAhead; i++) {
    const targetMonth = addMonths(startMonth, i);
    const installments: ProjectedInstallment[] = [];

    for (const tx of transactions) {
      if (tx.currency !== 'ARS') continue;
      if (tx.type !== 'expense' && tx.type !== 'third_party') continue;
      if (!tx.installments_total || tx.installments_total < 2 || !tx.first_installment_month) continue;
      if (!isValidYearMonth(tx.first_installment_month)) continue;

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

    const monthRecurringArs = activeRecurringArs.filter((item) => {
      const itemStart = normalizeMonth(item.start_month);
      return !itemStart || targetMonth >= itemStart;
    });
    const monthRecurringUsd = activeRecurringUsd.filter((item) => {
      const itemStart = normalizeMonth(item.start_month);
      return !itemStart || targetMonth >= itemStart;
    });
    const monthRecurringBrl = activeRecurringBrl.filter((item) => {
      const itemStart = normalizeMonth(item.start_month);
      return !itemStart || targetMonth >= itemStart;
    });
    const recurringTotal = round2(monthRecurringArs.reduce((sum, item) => sum + item.amount, 0));
    const recurringUsdTotal = round2(monthRecurringUsd.reduce((sum, item) => sum + item.amount, 0));
    const recurringBrlTotal = round2(monthRecurringBrl.reduce((sum, item) => sum + item.amount, 0));

    const installmentsTotal = round2(
      installments.reduce((sum, item) => sum + item.installment_amount, 0)
    );
    months.push({
      month: targetMonth,
      installments,
      installments_total_amount: installmentsTotal,
      recurring: monthRecurringArs,
      recurring_total_amount: recurringTotal,
      recurring_usd_total_amount: recurringUsdTotal,
      recurring_brl_total_amount: recurringBrlTotal,
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

export async function loadAllDataSnapshot(db: D1Database): Promise<{
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  transactions: Transaction[];
  recurringItems: RecurringItem[];
}> {
  const [accRes, catRes, tagRes, txRes, ttRes, recRes] = await db.batch([
    db.prepare('SELECT * FROM accounts ORDER BY is_default DESC, created_at ASC, name ASC'),
    db.prepare('SELECT * FROM categories ORDER BY type ASC, name ASC'),
    db.prepare('SELECT * FROM tags ORDER BY name ASC'),
    db.prepare('SELECT * FROM transactions ORDER BY occurred_at DESC, created_at DESC'),
    db.prepare('SELECT transaction_id, tag_id FROM transaction_tags ORDER BY tag_id ASC'),
    db.prepare('SELECT * FROM recurring_items ORDER BY active DESC, day_of_month ASC, name ASC'),
  ]);

  const tagMap = new Map<string, string[]>();
  for (const rel of (ttRes.results ?? []) as Array<{ transaction_id: string; tag_id: string }>) {
    const list = tagMap.get(rel.transaction_id) ?? [];
    list.push(rel.tag_id);
    tagMap.set(rel.transaction_id, list);
  }

  const transactions: Transaction[] = ((txRes.results ?? []) as RawTransactionRow[]).map((row) => ({
    ...row,
    tags: tagMap.get(row.id) ?? [],
  }));

  return {
    accounts: (accRes.results ?? []) as Account[],
    categories: (catRes.results ?? []) as Category[],
    tags: (tagRes.results ?? []) as Tag[],
    transactions,
    recurringItems: (recRes.results ?? []) as RecurringItem[],
  };
}

async function resolveTagIds(db: D1Database, rawTags: string[]): Promise<string[]> {
  const cleaned = rawTags
    .map((raw) => String(raw ?? '').trim().replace(/^#/, ''))
    .filter((s) => s.length > 0);
  if (cleaned.length === 0) return [];

  const uniqueRaw = Array.from(new Set(cleaned));
  const existingIds = new Set<string>();
  const CHUNK_SIZE = 80;
  for (let i = 0; i < uniqueRaw.length; i += CHUNK_SIZE) {
    const chunk = uniqueRaw.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const res = await db
      .prepare(`SELECT id FROM tags WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ id: string }>();
    for (const row of res.results ?? []) {
      existingIds.add(row.id);
    }
  }

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const raw of cleaned) {
    const id = existingIds.has(raw) ? raw : slugifyTag(raw);
    if (id.length > 0 && !seen.has(id)) {
      seen.add(id);
      resolved.push(id);
    }
  }
  return resolved;
}

async function syncTransactionTags(
  db: D1Database,
  transactionId: string,
  rawTags: string[]
): Promise<void> {
  const uniqueSlugs = await resolveTagIds(db, rawTags);

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
      .prepare('SELECT type, amount, currency, account_id, to_account_id FROM transactions')
      .all<Pick<Transaction, 'type' | 'amount' | 'currency' | 'account_id' | 'to_account_id'>>(),
  ]);

  return computeAccountBalances(accRes.results ?? [], txRes.results ?? []);
}

export async function createAccount(db: D1Database, input: AccountInput): Promise<AccountWithBalance> {
  if (!VALID_ACCOUNT_TYPES.has(input.type)) {
    throw new ValidationError('Tipo de cuenta inválido');
  }
  const cleanName = input.name.trim().slice(0, 60);
  if (!cleanName) {
    throw new ValidationError('El nombre de la cuenta es obligatorio');
  }

  const currency = normalizeCurrency(input.currency, 'ARS');
  if (!currency) {
    throw new ValidationError(`Moneda inválida. Soportadas: ${SUPPORTED_CURRENCIES.join(', ')}`);
  }

  const id = await generateUniqueId(db, 'accounts', cleanName, input.id);
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

  const dueDay = normalizeDueDay(input.due_day, input.type);

  await db
    .prepare(
      `INSERT INTO accounts (id, name, type, currency, initial_balance, color, is_default, due_day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, cleanName, input.type, currency, initialBalance, color, isDefault, dueDay, createdAt)
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
    throw new ValidationError('El nombre de la cuenta no puede quedar vacío');
  }

  const nextType = patch.type ?? existing.type;
  if (!VALID_ACCOUNT_TYPES.has(nextType)) {
    throw new ValidationError('Tipo de cuenta inválido');
  }

  let nextCurrency = existing.currency;
  if (patch.currency !== undefined) {
    const normalized = normalizeCurrency(patch.currency);
    if (!normalized) {
      throw new ValidationError(`Moneda inválida. Soportadas: ${SUPPORTED_CURRENCIES.join(', ')}`);
    }
    nextCurrency = normalized;
  }

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

  const nextDueDay =
    patch.due_day !== undefined
      ? normalizeDueDay(patch.due_day, nextType)
      : normalizeDueDay(existing.due_day ?? null, nextType);

  await db
    .prepare(
      `UPDATE accounts
       SET name = ?, type = ?, currency = ?, initial_balance = ?, color = ?, is_default = ?, due_day = ?
       WHERE id = ?`
    )
    .bind(nextName, nextType, nextCurrency, nextInitial, nextColor, nextIsDefault, nextDueDay, id)
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
  if (!isValidIsoDate(occurredAt)) {
    throw new ValidationError('Fecha inválida (formato esperado YYYY-MM-DD)');
  }
  const accounts = await listAccountsWithBalances(db);
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) {
    throw new NotFoundError('Cuenta no encontrada');
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
  if (!isValidYearMonth(input.statement_month)) {
    throw new ValidationError('Mes de resumen inválido (formato esperado YYYY-MM)');
  }
  if (!isValidIsoDate(input.occurred_at)) {
    throw new ValidationError('Fecha inválida (formato esperado YYYY-MM-DD)');
  }
  const baseAmount = Number(input.amount);
  if (!Number.isFinite(baseAmount) || baseAmount < 0) {
    throw new ValidationError('Monto inválido para pago de resumen');
  }
  const rawFees = input.fees_amount ?? 0;
  if (!Number.isFinite(rawFees) || rawFees < 0) {
    throw new ValidationError('Monto de sellos/impuestos inválido');
  }
  const feesAmount = rawFees > 0 ? round2(rawFees) : 0;
  const roundedBase = round2(baseAmount);
  if (roundedBase + feesAmount <= 0) {
    throw new ValidationError('El total a pagar debe ser mayor a 0');
  }

  const accRes = await db
    .prepare('SELECT * FROM accounts ORDER BY is_default DESC, created_at ASC, name ASC')
    .all<Account>();
  const allAccounts = accRes.results ?? [];
  const card = allAccounts.find((a) => a.id === input.card_account_id && a.type === 'credit_card');
  if (!card) {
    throw new NotFoundError('Tarjeta no encontrada');
  }

  const explicitFromId = input.from_account_id?.trim() ?? '';
  let fromAcc: Account | undefined;
  if (explicitFromId) {
    fromAcc = allAccounts.find((a) => a.id === explicitFromId && a.type !== 'credit_card');
    if (!fromAcc) {
      throw new ValidationError('La cuenta origen seleccionada no existe o es una tarjeta de crédito');
    }
    if (fromAcc.currency !== card.currency) {
      throw new ValidationError(
        `La cuenta origen (${fromAcc.currency}) debe tener la misma moneda que la tarjeta (${card.currency})`
      );
    }
  } else {
    fromAcc = pickDefaultLiquidAccount(allAccounts, card.currency) ?? undefined;
    if (!fromAcc) {
      throw new ValidationError('Creá al menos una cuenta líquida antes de registrar el pago del resumen.');
    }
    if (fromAcc.currency !== card.currency) {
      throw new ValidationError(
        `No tenés una cuenta líquida en ${card.currency} para pagar esta tarjeta.`
      );
    }
  }

  const createdAt = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  let feesTx: Transaction | null = null;

  if (feesAmount > 0) {
    const otrosRow = await db.prepare("SELECT id FROM categories WHERE id = 'otros'").first<{ id: string }>();
    const feesCategoryId = otrosRow ? 'otros' : null;
    const feesId = shortId();
    const feesDesc = `Sellos e impuestos resumen ${input.statement_month}`;
    stmts.push(
      db
        .prepare(
          `INSERT INTO transactions (
            id, type, amount, currency, account_id, to_account_id, category_id,
            description, occurred_at, source, raw_input, telegram_message_id,
            installments_total, first_installment_month, statement_month, budget_month, third_party_name, linked_group_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          feesId,
          'expense',
          feesAmount,
          card.currency,
          card.id,
          null,
          feesCategoryId,
          feesDesc,
          input.occurred_at,
          'web_statement_pay',
          null,
          null,
          null,
          null,
          input.statement_month,
          null,
          null,
          null,
          createdAt
        )
    );
    feesTx = {
      id: feesId,
      type: 'expense',
      amount: feesAmount,
      currency: card.currency,
      account_id: card.id,
      to_account_id: null,
      category_id: feesCategoryId,
      description: feesDesc,
      occurred_at: input.occurred_at,
      source: 'web_statement_pay',
      raw_input: null,
      telegram_message_id: null,
      installments_total: null,
      first_installment_month: null,
      statement_month: input.statement_month,
      budget_month: null,
      third_party_name: null,
      linked_group_id: null,
      tags: [],
      created_at: createdAt,
    };
  }

  const totalPaid = round2(roundedBase + feesAmount);
  const transferId = shortId();
  const transferDesc =
    input.description?.trim() || `Pago resumen ${card.name} ${input.statement_month}`;
  stmts.push(
    db
      .prepare(
        `INSERT INTO transactions (
          id, type, amount, currency, account_id, to_account_id, category_id,
          description, occurred_at, source, raw_input, telegram_message_id,
          installments_total, first_installment_month, statement_month, budget_month, third_party_name, linked_group_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        transferId,
        'transfer',
        totalPaid,
        card.currency,
        fromAcc.id,
        card.id,
        null,
        transferDesc,
        input.occurred_at,
        'web_statement_pay',
        null,
        null,
        null,
        null,
        input.statement_month,
        null,
        null,
        null,
        createdAt
      )
  );

  await db.batch(stmts);

  const transfer: Transaction = {
    id: transferId,
    type: 'transfer',
    amount: totalPaid,
    currency: card.currency,
    account_id: fromAcc.id,
    to_account_id: card.id,
    category_id: null,
    description: transferDesc,
    occurred_at: input.occurred_at,
    source: 'web_statement_pay',
    raw_input: null,
    telegram_message_id: null,
    installments_total: null,
    first_installment_month: null,
    statement_month: input.statement_month,
    budget_month: null,
    third_party_name: null,
    linked_group_id: null,
    tags: [],
    created_at: createdAt,
  };

  const { accounts, transactions, recurringItems } = await loadAllDataSnapshot(db);
  return {
    transfer,
    feesTx,
    accounts: computeAccountBalances(accounts, transactions),
    cardStatements: computeCardStatements(accounts, transactions, input.statement_month, recurringItems),
  };
}

export async function listCategories(db: D1Database): Promise<Category[]> {
  const res = await db.prepare('SELECT * FROM categories ORDER BY type ASC, name ASC').all<Category>();
  return res.results ?? [];
}

export async function createCategory(db: D1Database, input: CategoryInput): Promise<Category> {
  const cleanName = input.name.trim().slice(0, 60);
  if (!cleanName) throw new ValidationError('Nombre de categoría obligatorio');
  if (input.type && !VALID_CATEGORY_TYPES.has(input.type)) {
    throw new ValidationError('Tipo de categoría inválido');
  }
  const id = await generateUniqueId(db, 'categories', cleanName, input.id);
  const icon = input.icon.trim() || '📦';
  const color = input.color.trim() || '#9E9E9E';
  const type: CategoryType = input.type ?? 'expense';

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
  if (!nextName) throw new ValidationError('Nombre de categoría inválido');
  if (patch.type !== undefined && !VALID_CATEGORY_TYPES.has(patch.type)) {
    throw new ValidationError('Tipo de categoría inválido');
  }
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
  if (!id) throw new ValidationError('Nombre de etiqueta inválido');
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
  if (!VALID_TX_TYPES.has(input.type)) {
    throw new ValidationError('Tipo de movimiento inválido');
  }
  const description = input.description.trim();
  if (!description) {
    throw new ValidationError('La descripción es obligatoria');
  }
  if (!isValidIsoDate(input.occurred_at)) {
    throw new ValidationError('Fecha inválida (formato esperado YYYY-MM-DD)');
  }
  const rawAmount = Number(input.amount);
  if (!Number.isFinite(rawAmount)) {
    throw new ValidationError('Monto inválido');
  }
  const amount = round2(rawAmount);
  if (input.type === 'adjustment' ? amount === 0 : amount <= 0) {
    throw new ValidationError('Monto inválido');
  }

  const account = await db
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .bind(input.account_id)
    .first<Account>();
  if (!account) {
    throw new ValidationError('La cuenta seleccionada no existe');
  }

  if (input.currency !== undefined && input.currency !== null && input.currency.trim() !== '') {
    const normalized = normalizeCurrency(input.currency);
    if (!normalized) {
      throw new ValidationError(`Moneda inválida. Soportadas: ${SUPPORTED_CURRENCIES.join(', ')}`);
    }
    if (normalized !== account.currency) {
      throw new ValidationError(
        `La moneda (${normalized}) no coincide con la moneda de la cuenta (${account.currency})`
      );
    }
  }
  const currency = account.currency;

  let toAccountId: string | null = null;
  if (input.type === 'transfer') {
    if (!input.to_account_id || input.to_account_id === input.account_id) {
      throw new ValidationError('Cuenta destino inválida para transferencia');
    }
    const toAcc = await db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .bind(input.to_account_id)
      .first<Account>();
    if (!toAcc) {
      throw new ValidationError('La cuenta destino no existe');
    }
    if (toAcc.currency !== currency) {
      throw new ValidationError(
        `La cuenta destino (${toAcc.currency}) debe tener la misma moneda que la cuenta origen (${currency})`
      );
    }
    toAccountId = toAcc.id;
  }

  let budgetMonth: string | null = null;
  if (input.budget_month !== undefined && input.budget_month !== null && input.budget_month.trim() !== '') {
    const trimmed = input.budget_month.trim();
    if (!isValidYearMonth(trimmed)) {
      throw new ValidationError('Mes contable inválido (formato esperado YYYY-MM)');
    }
    budgetMonth = trimmed;
  }

  let statementMonth: string | null = null;
  if (
    input.statement_month !== undefined &&
    input.statement_month !== null &&
    input.statement_month.trim() !== ''
  ) {
    const trimmed = input.statement_month.trim();
    if (!isValidYearMonth(trimmed)) {
      throw new ValidationError('Mes de resumen inválido (formato esperado YYYY-MM)');
    }
    statementMonth = trimmed;
  }

  const allowsCategory = input.type === 'expense' || input.type === 'income';
  const categoryId = allowsCategory ? (input.category_id ?? null) : null;

  const allowsInstallments = input.type === 'expense' || input.type === 'third_party';
  const rawInstallments =
    allowsInstallments && input.installments_total !== undefined && input.installments_total !== null
      ? Math.trunc(Number(input.installments_total))
      : null;
  const installmentsTotal =
    rawInstallments !== null && Number.isFinite(rawInstallments) && rawInstallments >= 2
      ? rawInstallments
      : null;

  const defaultFirstMonth =
    account.type === 'credit_card'
      ? addMonths(input.occurred_at.slice(0, 7), 1)
      : input.occurred_at.slice(0, 7);
  const firstInstallmentMonth = installmentsTotal
    ? (normalizeMonth(input.first_installment_month) ?? defaultFirstMonth)
    : null;

  const allowsThirdParty = input.type === 'third_party' || input.type === 'third_party_repayment';
  const thirdPartyName = allowsThirdParty ? (input.third_party_name?.trim() || null) : null;

  const id = input.id ?? shortId();
  const createdAt = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO transactions (
        id, type, amount, currency, account_id, to_account_id, category_id,
        description, occurred_at, source, raw_input, telegram_message_id,
        installments_total, first_installment_month, statement_month, budget_month, third_party_name, linked_group_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.type,
      amount,
      currency,
      input.account_id,
      toAccountId,
      categoryId,
      description,
      input.occurred_at,
      input.source,
      input.raw_input ?? null,
      input.telegram_message_id ?? null,
      installmentsTotal,
      firstInstallmentMonth,
      statementMonth,
      budgetMonth,
      thirdPartyName,
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
  const description = input.description.trim();
  const thirdPartyName = input.third_party_name.trim();
  if (!description || !thirdPartyName) {
    throw new ValidationError('Descripción y nombre de tercero son obligatorios');
  }
  if (!isValidIsoDate(input.occurred_at)) {
    throw new ValidationError('Fecha inválida (formato esperado YYYY-MM-DD)');
  }
  if (
    !Number.isFinite(input.own_amount) ||
    !Number.isFinite(input.third_party_amount) ||
    input.own_amount < 0 ||
    input.third_party_amount <= 0
  ) {
    throw new ValidationError('Montos inválidos para compra compartida');
  }

  const account = await db
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .bind(input.account_id)
    .first<Account>();
  if (!account) {
    throw new ValidationError('La cuenta seleccionada no existe');
  }

  if (input.currency !== undefined && input.currency !== null && input.currency.trim() !== '') {
    const normalized = normalizeCurrency(input.currency);
    if (!normalized) {
      throw new ValidationError(`Moneda inválida. Soportadas: ${SUPPORTED_CURRENCIES.join(', ')}`);
    }
    if (normalized !== account.currency) {
      throw new ValidationError(
        `La moneda (${normalized}) no coincide con la moneda de la cuenta (${account.currency})`
      );
    }
  }
  const currency = account.currency;

  let statementMonth: string | null = null;
  if (
    input.statement_month !== undefined &&
    input.statement_month !== null &&
    input.statement_month.trim() !== ''
  ) {
    const trimmed = input.statement_month.trim();
    if (!isValidYearMonth(trimmed)) {
      throw new ValidationError('Mes de resumen inválido (formato esperado YYYY-MM)');
    }
    statementMonth = trimmed;
  }

  const ownAmount = round2(input.own_amount);
  const thirdAmount = round2(input.third_party_amount);

  let ownCategoryId: string | null = input.category_id ?? null;
  if (!ownCategoryId && ownAmount > 0) {
    const otrosRow = await db.prepare("SELECT id FROM categories WHERE id = 'otros'").first<{ id: string }>();
    ownCategoryId = otrosRow ? 'otros' : null;
  }

  const rawInstallments =
    input.installments_total !== undefined && input.installments_total !== null
      ? Math.trunc(Number(input.installments_total))
      : null;
  const installmentsTotal =
    rawInstallments !== null && Number.isFinite(rawInstallments) && rawInstallments >= 2
      ? rawInstallments
      : null;
  const defaultFirstMonth =
    account.type === 'credit_card'
      ? addMonths(input.occurred_at.slice(0, 7), 1)
      : input.occurred_at.slice(0, 7);
  const firstInstallmentMonth = installmentsTotal
    ? (normalizeMonth(input.first_installment_month) ?? defaultFirstMonth)
    : null;

  const uniqueTags = await resolveTagIds(db, input.tags ?? []);

  const linkedGroupId = shortId();
  const createdAt = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  const created: Transaction[] = [];

  for (const slug of uniqueTags) {
    stmts.push(
      db.prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)').bind(slug, slug, '#71717a')
    );
  }

  const pushSharedTx = (params: {
    type: 'expense' | 'third_party';
    amount: number;
    category_id: string | null;
    desc: string;
    third_party_name: string | null;
  }) => {
    const txId = shortId();
    stmts.push(
      db
        .prepare(
          `INSERT INTO transactions (
            id, type, amount, currency, account_id, to_account_id, category_id,
            description, occurred_at, source, raw_input, telegram_message_id,
            installments_total, first_installment_month, statement_month, budget_month, third_party_name, linked_group_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          txId,
          params.type,
          params.amount,
          currency,
          account.id,
          null,
          params.category_id,
          params.desc,
          input.occurred_at,
          input.source,
          input.raw_input ?? null,
          input.telegram_message_id ?? null,
          installmentsTotal,
          firstInstallmentMonth,
          statementMonth,
          null,
          params.third_party_name,
          linkedGroupId,
          createdAt
        )
    );
    for (const slug of uniqueTags) {
      stmts.push(
        db
          .prepare('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)')
          .bind(txId, slug)
      );
    }
    created.push({
      id: txId,
      type: params.type,
      amount: params.amount,
      currency,
      account_id: account.id,
      to_account_id: null,
      category_id: params.category_id,
      description: params.desc,
      occurred_at: input.occurred_at,
      source: input.source,
      raw_input: input.raw_input ?? null,
      telegram_message_id: input.telegram_message_id ?? null,
      installments_total: installmentsTotal,
      first_installment_month: firstInstallmentMonth,
      statement_month: statementMonth,
      budget_month: null,
      third_party_name: params.third_party_name,
      linked_group_id: linkedGroupId,
      tags: [...uniqueTags],
      created_at: createdAt,
    });
  };

  if (ownAmount > 0) {
    pushSharedTx({
      type: 'expense',
      amount: ownAmount,
      category_id: ownCategoryId,
      desc: `${description} (mi parte)`,
      third_party_name: null,
    });
  }

  if (thirdAmount > 0) {
    pushSharedTx({
      type: 'third_party',
      amount: thirdAmount,
      category_id: null,
      desc: `${description} (parte ${thirdPartyName})`,
      third_party_name: thirdPartyName,
    });
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  return { linked_group_id: linkedGroupId, transactions: created };
}

export async function getTransactionById(db: D1Database, id: string): Promise<Transaction | null> {
  const row = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<RawTransactionRow>();
  if (!row) return null;
  const hydrated = await hydrateTransactionTags(db, [row]);
  return hydrated[0] ?? null;
}

export async function getTransactionsByIds(db: D1Database, ids: string[]): Promise<Transaction[]> {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0)));
  if (uniqueIds.length === 0) return [];

  const rows: RawTransactionRow[] = [];
  const CHUNK_SIZE = 80;
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const res = await db
      .prepare(`SELECT * FROM transactions WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all<RawTransactionRow>();
    if (res.results) {
      rows.push(...res.results);
    }
  }

  return hydrateTransactionTags(db, rows);
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
      | 'budget_month'
      | 'third_party_name'
      | 'tags'
    >
  >
): Promise<Transaction | null> {
  const existing = await getTransactionById(db, id);
  if (!existing) return null;

  const nextType = patch.type ?? existing.type;
  if (!VALID_TX_TYPES.has(nextType)) {
    throw new ValidationError('Tipo de movimiento inválido');
  }

  const rawAmount = patch.amount !== undefined ? Number(patch.amount) : existing.amount;
  if (!Number.isFinite(rawAmount)) {
    throw new ValidationError('Monto inválido');
  }
  const nextAmount = round2(rawAmount);
  if (nextType === 'adjustment' ? nextAmount === 0 : nextAmount <= 0) {
    throw new ValidationError('Monto inválido');
  }

  const nextDescription =
    patch.description !== undefined ? patch.description.trim() : existing.description;
  if (!nextDescription) {
    throw new ValidationError('La descripción es obligatoria');
  }

  const nextOccurredAt = patch.occurred_at ?? existing.occurred_at;
  if (patch.occurred_at !== undefined && !isValidIsoDate(nextOccurredAt)) {
    throw new ValidationError('Fecha inválida (formato esperado YYYY-MM-DD)');
  }

  const nextAccountId = patch.account_id ?? existing.account_id;
  const targetAcc = await db
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .bind(nextAccountId)
    .first<Account>();
  if (!targetAcc) {
    throw new ValidationError('La cuenta seleccionada no existe');
  }

  let nextCurrency = targetAcc.currency;
  if (patch.currency !== undefined) {
    const normalized = normalizeCurrency(patch.currency);
    if (!normalized) {
      throw new ValidationError(`Moneda inválida. Soportadas: ${SUPPORTED_CURRENCIES.join(', ')}`);
    }
    if (normalized !== targetAcc.currency) {
      throw new ValidationError(
        `La moneda (${normalized}) no coincide con la moneda de la cuenta (${targetAcc.currency})`
      );
    }
    nextCurrency = normalized;
  }

  let nextToAccountId: string | null = null;
  if (nextType === 'transfer') {
    const candidateToId =
      patch.to_account_id !== undefined ? patch.to_account_id : existing.to_account_id;
    if (!candidateToId || candidateToId === nextAccountId) {
      throw new ValidationError('Cuenta destino inválida para transferencia');
    }
    const toAcc = await db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .bind(candidateToId)
      .first<Account>();
    if (!toAcc) {
      throw new ValidationError('La cuenta destino no existe');
    }
    if (toAcc.currency !== nextCurrency) {
      throw new ValidationError(
        `La cuenta destino (${toAcc.currency}) debe tener la misma moneda que la cuenta origen (${nextCurrency})`
      );
    }
    nextToAccountId = toAcc.id;
  }

  const allowsCategory = nextType === 'expense' || nextType === 'income';
  const nextCategoryId = allowsCategory
    ? patch.category_id !== undefined
      ? patch.category_id
      : existing.category_id
    : null;

  const allowsThirdParty = nextType === 'third_party' || nextType === 'third_party_repayment';
  const rawThirdParty =
    patch.third_party_name !== undefined ? patch.third_party_name : existing.third_party_name;
  const nextThirdPartyName = allowsThirdParty ? (rawThirdParty?.trim() || null) : null;

  const allowsInstallments = nextType === 'expense' || nextType === 'third_party';
  const rawInstCandidate =
    patch.installments_total !== undefined ? patch.installments_total : existing.installments_total;
  const parsedInst =
    allowsInstallments && rawInstCandidate !== null && rawInstCandidate !== undefined
      ? Math.trunc(Number(rawInstCandidate))
      : null;
  const nextInstallmentsTotal =
    parsedInst !== null && Number.isFinite(parsedInst) && parsedInst >= 2 ? parsedInst : null;

  const rawFirstMonth =
    patch.first_installment_month !== undefined
      ? patch.first_installment_month
      : existing.first_installment_month;
  const defaultFirstMonth =
    targetAcc.type === 'credit_card'
      ? addMonths(nextOccurredAt.slice(0, 7), 1)
      : nextOccurredAt.slice(0, 7);
  const nextFirstInstallmentMonth = nextInstallmentsTotal
    ? (normalizeMonth(rawFirstMonth) ?? defaultFirstMonth)
    : null;

  let nextStatementMonth = existing.statement_month;
  if (patch.statement_month !== undefined) {
    if (patch.statement_month === null || patch.statement_month.trim() === '') {
      nextStatementMonth = null;
    } else {
      const trimmed = patch.statement_month.trim();
      if (!isValidYearMonth(trimmed)) {
        throw new ValidationError('Mes de resumen inválido (formato esperado YYYY-MM)');
      }
      nextStatementMonth = trimmed;
    }
  }

  let nextBudgetMonth = existing.budget_month;
  if (patch.budget_month !== undefined) {
    if (patch.budget_month === null || patch.budget_month.trim() === '') {
      nextBudgetMonth = null;
    } else {
      const trimmed = patch.budget_month.trim();
      if (!isValidYearMonth(trimmed)) {
        throw new ValidationError('Mes contable inválido (formato esperado YYYY-MM)');
      }
      nextBudgetMonth = trimmed;
    }
  }

  await db
    .prepare(
      `UPDATE transactions
       SET type = ?, amount = ?, currency = ?, account_id = ?, to_account_id = ?,
           category_id = ?, description = ?, occurred_at = ?,
           installments_total = ?, first_installment_month = ?, statement_month = ?, budget_month = ?, third_party_name = ?
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
      nextBudgetMonth,
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

  const effectiveDateExpr =
    "CASE WHEN t.budget_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' THEN t.budget_month || '-01' ELSE t.occurred_at END";

  if (filters.from && filters.to) {
    conditions.push(`${effectiveDateExpr} >= ? AND ${effectiveDateExpr} <= ?`);
    bindings.push(filters.from, filters.to);
  } else if (filters.month) {
    const { start, end } = getMonthDateRange(filters.month);
    conditions.push(`${effectiveDateExpr} >= ? AND ${effectiveDateExpr} <= ?`);
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
    const rawTag = filters.tagId.trim().replace(/^#/, '');
    const slugTag = slugifyTag(filters.tagId);
    conditions.push(
      'EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND (tt.tag_id = ? OR tt.tag_id = ?))'
    );
    bindings.push(rawTag, slugTag);
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
    today?: string;
  }
): Promise<MonthSummary> {
  const { accounts, categories, tags, transactions, recurringItems } = await loadAllDataSnapshot(db);
  return computePeriodMetrics(accounts, transactions, categories, tags, {
    from: options.from,
    to: options.to,
    basis: options.basis ?? 'cash',
    statementMonth: options.statementMonth,
    recurringItems,
    today: options.today,
  });
}

export async function getMonthSummary(
  db: D1Database,
  month: string,
  basis: AccountingBasis = 'cash',
  today?: string
): Promise<MonthSummary> {
  const { start, end } = getMonthDateRange(month);
  return getPeriodSummary(db, { from: start, to: end, basis, statementMonth: month, today });
}

export async function getMonthlyHistory(
  db: D1Database,
  options: { from: string; to: string; basis?: AccountingBasis }
): Promise<MonthlyHistoryPoint[]> {
  const { accounts, transactions } = await loadAllDataSnapshot(db);
  return computeMonthlyHistory(accounts, transactions, options);
}

export async function listRecurringItems(db: D1Database): Promise<RecurringItem[]> {
  const res = await db
    .prepare('SELECT * FROM recurring_items ORDER BY active DESC, day_of_month ASC, name ASC')
    .all<RecurringItem>();
  return res.results ?? [];
}

export async function createRecurringItem(db: D1Database, input: RecurringItemInput): Promise<RecurringItem> {
  const cleanName = input.name.trim();
  if (!cleanName) {
    throw new ValidationError('El nombre es obligatorio');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ValidationError('El monto debe ser mayor a 0');
  }

  const account = await db
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .bind(input.account_id)
    .first<Account>();
  if (!account) {
    throw new ValidationError('La cuenta seleccionada no existe');
  }

  if (input.currency !== undefined && input.currency !== null && input.currency.trim() !== '') {
    const normalized = normalizeCurrency(input.currency);
    if (!normalized) {
      throw new ValidationError(`Moneda inválida. Soportadas: ${SUPPORTED_CURRENCIES.join(', ')}`);
    }
    if (normalized !== account.currency) {
      throw new ValidationError(
        `La moneda (${normalized}) no coincide con la moneda de la cuenta (${account.currency})`
      );
    }
  }
  const currency = account.currency;

  if (
    input.day_of_month !== undefined &&
    input.day_of_month !== null &&
    (!Number.isInteger(input.day_of_month) || input.day_of_month < 1 || input.day_of_month > 31)
  ) {
    throw new ValidationError('day_of_month debe ser un entero entre 1 y 31');
  }

  let startMonth: string | null = null;
  if (input.start_month !== undefined && input.start_month !== null && input.start_month.trim() !== '') {
    const trimmed = input.start_month.trim();
    if (!isValidYearMonth(trimmed)) {
      throw new ValidationError('start_month inválido (formato esperado YYYY-MM)');
    }
    startMonth = trimmed;
  }

  const id = shortId();
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO recurring_items (id, name, type, amount, currency, account_id, category_id, day_of_month, start_month, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      cleanName,
      input.type === 'income' ? 'income' : 'expense',
      round2(input.amount),
      currency,
      input.account_id,
      input.category_id ?? null,
      input.day_of_month ?? null,
      startMonth,
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

  const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
  if (!nextName) {
    throw new ValidationError('El nombre es obligatorio');
  }

  const nextAmount = patch.amount !== undefined ? Number(patch.amount) : existing.amount;
  if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
    throw new ValidationError('El monto debe ser mayor a 0');
  }

  const nextAccountId = patch.account_id ?? existing.account_id;
  const account = await db
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .bind(nextAccountId)
    .first<Account>();
  if (!account) {
    throw new ValidationError('La cuenta seleccionada no existe');
  }

  let nextCurrency = account.currency;
  if (patch.currency !== undefined) {
    const normalized = normalizeCurrency(patch.currency);
    if (!normalized) {
      throw new ValidationError(`Moneda inválida. Soportadas: ${SUPPORTED_CURRENCIES.join(', ')}`);
    }
    if (normalized !== account.currency) {
      throw new ValidationError(
        `La moneda (${normalized}) no coincide con la moneda de la cuenta (${account.currency})`
      );
    }
    nextCurrency = normalized;
  }

  if (
    patch.day_of_month !== undefined &&
    patch.day_of_month !== null &&
    (!Number.isInteger(patch.day_of_month) || patch.day_of_month < 1 || patch.day_of_month > 31)
  ) {
    throw new ValidationError('day_of_month debe ser un entero entre 1 y 31');
  }

  let nextStartMonth = existing.start_month;
  if (patch.start_month !== undefined) {
    if (patch.start_month === null || patch.start_month.trim() === '') {
      nextStartMonth = null;
    } else {
      const trimmed = patch.start_month.trim();
      if (!isValidYearMonth(trimmed)) {
        throw new ValidationError('start_month inválido (formato esperado YYYY-MM)');
      }
      nextStartMonth = trimmed;
    }
  }

  await db
    .prepare(
      `UPDATE recurring_items
       SET name = ?, type = ?, amount = ?, currency = ?, account_id = ?, category_id = ?, day_of_month = ?, start_month = ?, active = ?
       WHERE id = ?`
    )
    .bind(
      nextName,
      patch.type !== undefined ? (patch.type === 'income' ? 'income' : 'expense') : existing.type,
      round2(nextAmount),
      nextCurrency,
      nextAccountId,
      patch.category_id !== undefined ? patch.category_id : existing.category_id,
      patch.day_of_month !== undefined ? patch.day_of_month : existing.day_of_month,
      nextStartMonth,
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
         WHERE installments_total IS NOT NULL AND installments_total >= 2 AND currency = ?`
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
