import { Hono } from 'hono';
import { timingSafeEqual, verifyDashboardAuth } from './auth';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  computeFutureProjection,
  computeMonthlyHistory,
  computePeriodMetrics,
  computeSavingsBalance,
  createAccount,
  createCategory,
  createRecurringItem,
  createSharedPurchase,
  createTag,
  createTransaction,
  deleteAccount,
  deleteCategory,
  deleteRecurringItem,
  deleteTag,
  deleteTransaction,
  effectiveTransactionDate,
  getFutureProjection,
  listAccountsWithBalances,
  listCategories,
  listRecurringItems,
  listTags,
  listTransactions,
  loadAllDataSnapshot,
  payCardStatement,
  reconcileAccountBalance,
  updateAccount,
  updateCategory,
  updateRecurringItem,
  updateTag,
  updateTransaction,
} from './db';
import { handleTelegramUpdate, type TelegramUpdate } from './telegram';
import {
  SUPPORTED_CURRENCIES,
  type Account,
  type AccountInput,
  type AccountPatch,
  type AccountingBasis,
  type CategoryInput,
  type CategoryPatch,
  type CategoryType,
  type Env,
  type PayStatementInput,
  type RecurringItemInput,
  type SharedPurchaseInput,
  type TagPatch,
  type TransactionInput,
  type TransactionType,
} from './types';
import {
  addMonths,
  currentMonthInTimezone,
  getMonthDateRange,
  isValidIsoDate,
  isValidYearMonth,
  normalizeCurrency,
  slugifyTag,
  todayInTimezone,
} from './utils';

const app = new Hono<{ Bindings: Env }>();

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

function parseYearMonthParam(raw: string | undefined, label: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  const trimmed = raw.trim();
  if (!isValidYearMonth(trimmed)) {
    throw new ValidationError(`${label} inválido (formato esperado YYYY-MM)`);
  }
  return trimmed;
}

function parseIsoDateParam(raw: string | undefined, label: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  const trimmed = raw.trim();
  if (!isValidIsoDate(trimmed)) {
    throw new ValidationError(`${label} inválida (formato esperado YYYY-MM-DD)`);
  }
  return trimmed;
}

function parseIntRangeParam(
  raw: string | undefined,
  min: number,
  max: number,
  label: string
): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(`${label} inválido (entero entre ${min} y ${max})`);
  }
  return parsed;
}

app.onError((err, c) => {
  if (err instanceof ValidationError) {
    return c.json({ error: err.message }, 400);
  }
  if (err instanceof ConflictError) {
    return c.json({ error: err.message }, 409);
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: err.message }, 404);
  }
  if (err instanceof SyntaxError || /malformed json/i.test(err.message)) {
    return c.json({ error: 'JSON inválido' }, 400);
  }
  if (/FOREIGN KEY constraint failed|CHECK constraint failed|NOT NULL constraint failed/i.test(err.message)) {
    return c.json({ error: 'Datos inválidos o referencia inexistente' }, 400);
  }
  console.error('Unhandled API error:', err);
  return c.json({ error: 'Error interno del servidor' }, 500);
});

app.get('/api/health', (c) => {
  return c.json({ ok: true, env: c.env.APP_ENV || 'production' });
});

app.post('/webhook/telegram', async (c) => {
  const expectedSecret = c.env.TELEGRAM_WEBHOOK_SECRET;
  const incomingSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (
    !expectedSecret ||
    !expectedSecret.trim() ||
    !incomingSecret ||
    !(await timingSafeEqual(incomingSecret, expectedSecret))
  ) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  let update: TelegramUpdate;
  try {
    update = await c.req.json<TelegramUpdate>();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  c.executionCtx.waitUntil(handleTelegramUpdate(c.env, update));
  return c.json({ ok: true });
});

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') {
    await next();
    return;
  }
  return verifyDashboardAuth(c, next);
});

app.get('/api/bootstrap', async (c) => {
  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const currentMonth = currentMonthInTimezone(tz);
  const month = parseYearMonthParam(c.req.query('month'), 'month') ?? currentMonth;
  const fallbackRange = getMonthDateRange(month);
  const from = parseIsoDateParam(c.req.query('from'), 'from') ?? fallbackRange.start;
  const to = parseIsoDateParam(c.req.query('to'), 'to') ?? fallbackRange.end;
  if (from > to) {
    throw new ValidationError('Rango de fechas inválido: from no puede ser posterior a to');
  }
  const basis: AccountingBasis = c.req.query('basis') === 'accrual' ? 'accrual' : 'cash';
  const statementMonth =
    parseYearMonthParam(c.req.query('statementMonth'), 'statementMonth') ?? currentMonth;
  const nextMonth = addMonths(currentMonth, 1);

  const defaultCurrency = normalizeCurrency(c.env.DEFAULT_CURRENCY, 'ARS') ?? 'ARS';
  const today = todayInTimezone(tz);

  const snapshot = await loadAllDataSnapshot(c.env.DB);
  const summary = computePeriodMetrics(
    snapshot.accounts,
    snapshot.transactions,
    snapshot.categories,
    snapshot.tags,
    {
      from,
      to,
      basis,
      statementMonth,
      recurringItems: snapshot.recurringItems,
      today,
    }
  );
  const monthlyHistory = computeMonthlyHistory(snapshot.accounts, snapshot.transactions, {
    from,
    to,
    basis,
  });

  const matched = snapshot.transactions.filter((tx) => {
    const effDate = effectiveTransactionDate(tx);
    return effDate >= from && effDate <= to;
  });
  const hasMore = matched.length > 2500;
  const transactions = matched.slice(0, 2500);

  const txIdSet = new Set(transactions.map((t) => t.id));
  const referencedIdSet = new Set(
    summary.paid_statement_items
      .map((i) => i.transaction_id)
      .filter((id) => !txIdSet.has(id))
  );
  const referencedTransactions = snapshot.transactions.filter((t) => referencedIdSet.has(t.id));

  const reservas = computeSavingsBalance(summary.accounts, defaultCurrency);
  const projection = computeFutureProjection(
    snapshot.transactions,
    snapshot.recurringItems,
    reservas,
    nextMonth,
    3
  );

  return c.json({
    month: from.slice(0, 7),
    from,
    to,
    basis,
    statementMonth,
    today,
    timezone: tz,
    accounts: summary.accounts,
    categories: snapshot.categories,
    tags: snapshot.tags,
    summary,
    monthlyHistory,
    transactions,
    hasMore,
    referencedTransactions,
    recurringItems: snapshot.recurringItems,
    projection,
    cardStatements: summary.card_statements,
    overdueStatements: summary.overdue_card_alerts,
  });
});

app.get('/api/transactions', async (c) => {
  const month = parseYearMonthParam(c.req.query('month'), 'month');
  const from = parseIsoDateParam(c.req.query('from'), 'from');
  const to = parseIsoDateParam(c.req.query('to'), 'to');
  if (from && to && from > to) {
    throw new ValidationError('Rango de fechas inválido: from no puede ser posterior a to');
  }
  const limit = parseIntRangeParam(c.req.query('limit'), 1, 2500, 'limit') ?? 500;
  const rawType = c.req.query('type') as TransactionType | undefined;

  const txs = await listTransactions(c.env.DB, {
    month,
    from,
    to,
    accountId: c.req.query('accountId') || undefined,
    categoryId: c.req.query('categoryId') || undefined,
    tagId: c.req.query('tagId') || undefined,
    type: rawType && VALID_TX_TYPES.has(rawType) ? rawType : undefined,
    search: c.req.query('search') || undefined,
    limit,
  });
  return c.json({ transactions: txs });
});

app.post('/api/transactions', async (c) => {
  const body = await c.req.json<Partial<TransactionInput>>();
  if (
    !body.type ||
    !VALID_TX_TYPES.has(body.type) ||
    typeof body.account_id !== 'string' ||
    !body.account_id.trim() ||
    typeof body.description !== 'string' ||
    !body.description.trim()
  ) {
    return c.json({ error: 'Datos inválidos' }, 400);
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || (body.type === 'adjustment' ? amount === 0 : amount <= 0)) {
    return c.json({ error: 'Monto inválido' }, 400);
  }
  if (body.type === 'transfer' && (!body.to_account_id || body.to_account_id === body.account_id)) {
    return c.json({ error: 'Cuenta destino inválida para transferencia' }, 400);
  }
  if (body.occurred_at !== undefined && (typeof body.occurred_at !== 'string' || !isValidIsoDate(body.occurred_at))) {
    return c.json({ error: 'Fecha inválida (formato esperado YYYY-MM-DD)' }, 400);
  }
  if (body.currency !== undefined && body.currency !== null && body.currency.trim() !== '') {
    if (!normalizeCurrency(body.currency)) {
      return c.json({ error: `Moneda inválida. Soportadas: ${SUPPORTED_CURRENCIES.join(', ')}` }, 400);
    }
  }
  if (
    body.installments_total !== undefined &&
    body.installments_total !== null &&
    !Number.isFinite(Number(body.installments_total))
  ) {
    return c.json({ error: 'Cantidad de cuotas inválida' }, 400);
  }
  if (
    body.first_installment_month !== undefined &&
    body.first_installment_month !== null &&
    body.first_installment_month.trim() !== '' &&
    !isValidYearMonth(body.first_installment_month.trim())
  ) {
    return c.json({ error: 'first_installment_month inválido (formato esperado YYYY-MM)' }, 400);
  }

  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const tx = await createTransaction(c.env.DB, {
    type: body.type,
    amount,
    currency: body.currency && body.currency.trim() ? body.currency : undefined,
    account_id: body.account_id.trim(),
    to_account_id: body.to_account_id ?? null,
    category_id: body.category_id ?? null,
    description: body.description.trim(),
    occurred_at: body.occurred_at || todayInTimezone(tz),
    source: 'web',
    installments_total: body.installments_total ?? null,
    first_installment_month: body.first_installment_month ?? null,
    statement_month: body.statement_month ?? null,
    budget_month: body.budget_month ?? null,
    third_party_name: body.third_party_name ?? null,
    linked_group_id: body.linked_group_id ?? null,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
  });
  return c.json({ transaction: tx }, 201);
});

app.post('/api/transactions/shared', async (c) => {
  const body = await c.req.json<Partial<SharedPurchaseInput>>();
  if (
    typeof body.account_id !== 'string' ||
    !body.account_id.trim() ||
    typeof body.description !== 'string' ||
    !body.description.trim() ||
    typeof body.third_party_name !== 'string' ||
    !body.third_party_name.trim() ||
    typeof body.own_amount !== 'number' ||
    !Number.isFinite(body.own_amount) ||
    typeof body.third_party_amount !== 'number' ||
    !Number.isFinite(body.third_party_amount) ||
    body.own_amount < 0 ||
    body.third_party_amount <= 0
  ) {
    return c.json({ error: 'Datos inválidos para compra compartida' }, 400);
  }
  if (body.occurred_at !== undefined && (typeof body.occurred_at !== 'string' || !isValidIsoDate(body.occurred_at))) {
    return c.json({ error: 'Fecha inválida (formato esperado YYYY-MM-DD)' }, 400);
  }
  if (body.currency !== undefined && body.currency !== null && body.currency.trim() !== '') {
    if (!normalizeCurrency(body.currency)) {
      return c.json({ error: `Moneda inválida. Soportadas: ${SUPPORTED_CURRENCIES.join(', ')}` }, 400);
    }
  }
  if (
    body.statement_month !== undefined &&
    body.statement_month !== null &&
    body.statement_month.trim() !== '' &&
    !isValidYearMonth(body.statement_month.trim())
  ) {
    return c.json({ error: 'statement_month inválido (formato esperado YYYY-MM)' }, 400);
  }
  if (
    body.first_installment_month !== undefined &&
    body.first_installment_month !== null &&
    body.first_installment_month.trim() !== '' &&
    !isValidYearMonth(body.first_installment_month.trim())
  ) {
    return c.json({ error: 'first_installment_month inválido (formato esperado YYYY-MM)' }, 400);
  }

  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const result = await createSharedPurchase(c.env.DB, {
    account_id: body.account_id.trim(),
    currency: body.currency && body.currency.trim() ? body.currency : undefined,
    category_id: body.category_id ?? null,
    description: body.description.trim(),
    occurred_at: body.occurred_at || todayInTimezone(tz),
    own_amount: body.own_amount,
    third_party_amount: body.third_party_amount,
    third_party_name: body.third_party_name.trim(),
    installments_total: body.installments_total ?? null,
    first_installment_month: body.first_installment_month ?? null,
    statement_month: body.statement_month ?? null,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
    source: 'web',
  });
  return c.json(result, 201);
});

app.patch('/api/transactions/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<TransactionInput>>();
  const updated = await updateTransaction(c.env.DB, id, body);
  if (!updated) {
    return c.json({ error: 'Movimiento no encontrado' }, 404);
  }
  return c.json({ transaction: updated });
});

app.delete('/api/transactions/:id', async (c) => {
  const id = c.req.param('id');
  const ok = await deleteTransaction(c.env.DB, id);
  if (!ok) {
    return c.json({ error: 'Movimiento no encontrado' }, 404);
  }
  return c.json({ ok: true });
});

app.get('/api/accounts', async (c) => {
  const accounts = await listAccountsWithBalances(c.env.DB);
  return c.json({ accounts });
});

app.post('/api/accounts', async (c) => {
  const body = await c.req.json<Partial<AccountInput>>();
  if (typeof body.name !== 'string' || !body.name.trim() || !body.type) {
    return c.json({ error: 'Nombre y tipo de cuenta son obligatorios' }, 400);
  }
  if (
    body.initial_balance !== undefined &&
    (typeof body.initial_balance !== 'number' || !Number.isFinite(body.initial_balance))
  ) {
    return c.json({ error: 'initial_balance debe ser numérico' }, 400);
  }
  if (
    body.due_day !== undefined &&
    body.due_day !== null &&
    (!Number.isInteger(body.due_day) || body.due_day < 1 || body.due_day > 31)
  ) {
    return c.json({ error: 'due_day debe ser un entero entre 1 y 31' }, 400);
  }
  const currency =
    body.currency !== undefined && body.currency !== null && body.currency.trim() !== ''
      ? normalizeCurrency(body.currency)
      : (normalizeCurrency(c.env.DEFAULT_CURRENCY, 'ARS') ?? 'ARS');
  if (!currency) {
    return c.json({ error: `Moneda inválida. Soportadas: ${SUPPORTED_CURRENCIES.join(', ')}` }, 400);
  }

  const account = await createAccount(c.env.DB, {
    id: body.id,
    name: body.name,
    type: body.type,
    currency,
    initial_balance: body.initial_balance,
    color: body.color,
    is_default: body.is_default,
    due_day: body.due_day ?? null,
  });
  const accounts = await listAccountsWithBalances(c.env.DB);
  return c.json({ account, accounts }, 201);
});

app.patch('/api/accounts/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<AccountPatch>();
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    return c.json({ error: 'El nombre de la cuenta no puede quedar vacío' }, 400);
  }
  if (body.currency !== undefined && !normalizeCurrency(body.currency)) {
    return c.json({ error: `Moneda inválida. Soportadas: ${SUPPORTED_CURRENCIES.join(', ')}` }, 400);
  }
  if (
    body.initial_balance !== undefined &&
    (typeof body.initial_balance !== 'number' || !Number.isFinite(body.initial_balance))
  ) {
    return c.json({ error: 'initial_balance debe ser numérico' }, 400);
  }
  if (
    body.due_day !== undefined &&
    body.due_day !== null &&
    (!Number.isInteger(body.due_day) || body.due_day < 1 || body.due_day > 31)
  ) {
    return c.json({ error: 'due_day debe ser un entero entre 1 y 31' }, 400);
  }

  const updated = await updateAccount(c.env.DB, id, body);
  if (!updated) {
    return c.json({ error: 'Cuenta no encontrada' }, 404);
  }
  const accounts = await listAccountsWithBalances(c.env.DB);
  return c.json({ account: updated, accounts });
});

app.delete('/api/accounts/:id', async (c) => {
  const id = c.req.param('id');
  const ok = await deleteAccount(c.env.DB, id);
  if (!ok) {
    return c.json({ error: 'Cuenta no encontrada' }, 404);
  }
  const accounts = await listAccountsWithBalances(c.env.DB);
  return c.json({ ok: true, accounts });
});

app.post('/api/accounts/:id/reconcile', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ real_balance?: number; occurred_at?: string; description?: string }>();
  if (typeof body.real_balance !== 'number' || !Number.isFinite(body.real_balance)) {
    return c.json({ error: 'real_balance debe ser numérico' }, 400);
  }
  if (body.occurred_at !== undefined && (typeof body.occurred_at !== 'string' || !isValidIsoDate(body.occurred_at))) {
    return c.json({ error: 'Fecha inválida (formato esperado YYYY-MM-DD)' }, 400);
  }
  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const result = await reconcileAccountBalance(
    c.env.DB,
    id,
    body.real_balance,
    body.occurred_at || todayInTimezone(tz),
    body.description
  );
  return c.json(result);
});

app.post('/api/cards/:id/pay-statement', async (c) => {
  const cardId = c.req.param('id');
  const body = await c.req.json<Partial<PayStatementInput>>();
  if (
    typeof body.statement_month !== 'string' ||
    !isValidYearMonth(body.statement_month.trim()) ||
    typeof body.amount !== 'number' ||
    !Number.isFinite(body.amount) ||
    body.amount < 0
  ) {
    return c.json({ error: 'Datos inválidos para pago de resumen' }, 400);
  }
  if (body.fees_amount !== undefined && body.fees_amount !== null) {
    if (typeof body.fees_amount !== 'number' || !Number.isFinite(body.fees_amount) || body.fees_amount < 0) {
      return c.json({ error: 'fees_amount inválido' }, 400);
    }
  }
  if (body.occurred_at !== undefined && (typeof body.occurred_at !== 'string' || !isValidIsoDate(body.occurred_at))) {
    return c.json({ error: 'Fecha inválida (formato esperado YYYY-MM-DD)' }, 400);
  }
  const fees = typeof body.fees_amount === 'number' && body.fees_amount > 0 ? body.fees_amount : 0;
  if (body.amount + fees <= 0) {
    return c.json({ error: 'El total a pagar debe ser mayor a 0' }, 400);
  }

  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const result = await payCardStatement(c.env.DB, {
    card_account_id: cardId,
    statement_month: body.statement_month.trim(),
    from_account_id: body.from_account_id || '',
    amount: body.amount,
    fees_amount: fees,
    occurred_at: body.occurred_at || todayInTimezone(tz),
    description: body.description,
  });
  return c.json(result, 201);
});

app.get('/api/categories', async (c) => {
  const categories = await listCategories(c.env.DB);
  return c.json({ categories });
});

app.post('/api/categories', async (c) => {
  const body = await c.req.json<Partial<CategoryInput>>();
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Nombre de categoría obligatorio' }, 400);
  }
  if (body.type !== undefined && !VALID_CATEGORY_TYPES.has(body.type)) {
    return c.json({ error: 'Tipo de categoría inválido' }, 400);
  }
  const category = await createCategory(c.env.DB, {
    id: body.id,
    name: body.name,
    icon: body.icon || '📦',
    type: body.type || 'expense',
    color: body.color || '#9E9E9E',
  });
  const categories = await listCategories(c.env.DB);
  return c.json({ category, categories }, 201);
});

app.patch('/api/categories/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<CategoryPatch>();
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    return c.json({ error: 'Nombre de categoría inválido' }, 400);
  }
  if (body.type !== undefined && !VALID_CATEGORY_TYPES.has(body.type)) {
    return c.json({ error: 'Tipo de categoría inválido' }, 400);
  }
  const updated = await updateCategory(c.env.DB, id, body);
  if (!updated) {
    return c.json({ error: 'Categoría no encontrada' }, 404);
  }
  const categories = await listCategories(c.env.DB);
  return c.json({ category: updated, categories });
});

app.delete('/api/categories/:id', async (c) => {
  const id = c.req.param('id');
  const ok = await deleteCategory(c.env.DB, id);
  if (!ok) {
    return c.json({ error: 'Categoría no encontrada' }, 404);
  }
  const categories = await listCategories(c.env.DB);
  return c.json({ ok: true, categories });
});

app.get('/api/tags', async (c) => {
  const tags = await listTags(c.env.DB);
  return c.json({ tags });
});

app.post('/api/tags', async (c) => {
  const body = await c.req.json<{ name?: string; color?: string }>();
  if (typeof body.name !== 'string' || !body.name.trim() || !slugifyTag(body.name)) {
    return c.json({ error: 'Nombre de etiqueta inválido' }, 400);
  }
  const tag = await createTag(c.env.DB, body.name, body.color || '#71717a');
  return c.json({ tag }, 201);
});

app.patch('/api/tags/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<TagPatch>();
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    return c.json({ error: 'Nombre de etiqueta inválido' }, 400);
  }
  const updated = await updateTag(c.env.DB, id, body);
  if (!updated) {
    return c.json({ error: 'Etiqueta no encontrada' }, 404);
  }
  const tags = await listTags(c.env.DB);
  return c.json({ tag: updated, tags });
});

app.delete('/api/tags/:id', async (c) => {
  const id = c.req.param('id');
  const ok = await deleteTag(c.env.DB, id);
  if (!ok) {
    return c.json({ error: 'Etiqueta no encontrada' }, 404);
  }
  const tags = await listTags(c.env.DB);
  return c.json({ ok: true, tags });
});

app.get('/api/recurring', async (c) => {
  const items = await listRecurringItems(c.env.DB);
  return c.json({ recurringItems: items });
});

app.post('/api/recurring', async (c) => {
  const body = await c.req.json<Partial<RecurringItemInput>>();
  if (
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    typeof body.account_id !== 'string' ||
    !body.account_id.trim() ||
    typeof body.amount !== 'number' ||
    !Number.isFinite(body.amount) ||
    body.amount <= 0
  ) {
    return c.json({ error: 'Datos inválidos' }, 400);
  }
  if (
    body.day_of_month !== undefined &&
    body.day_of_month !== null &&
    (!Number.isInteger(body.day_of_month) || body.day_of_month < 1 || body.day_of_month > 31)
  ) {
    return c.json({ error: 'day_of_month debe ser un entero entre 1 y 31' }, 400);
  }
  if (body.currency !== undefined && body.currency !== null && body.currency.trim() !== '') {
    if (!normalizeCurrency(body.currency)) {
      return c.json({ error: `Moneda inválida. Soportadas: ${SUPPORTED_CURRENCIES.join(', ')}` }, 400);
    }
  }

  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  let startMonth: string | null;
  if (body.start_month === undefined) {
    startMonth = currentMonthInTimezone(tz);
  } else if (body.start_month === null || body.start_month.trim() === '') {
    startMonth = null;
  } else {
    const trimmed = body.start_month.trim();
    if (!isValidYearMonth(trimmed)) {
      return c.json({ error: 'start_month inválido (formato esperado YYYY-MM)' }, 400);
    }
    startMonth = trimmed;
  }

  const item = await createRecurringItem(c.env.DB, {
    name: body.name.trim(),
    type: body.type === 'income' ? 'income' : 'expense',
    amount: body.amount,
    currency: body.currency && body.currency.trim() ? body.currency : undefined,
    account_id: body.account_id.trim(),
    category_id: body.category_id ?? null,
    day_of_month: body.day_of_month ?? null,
    start_month: startMonth,
    active: body.active ?? 1,
  });
  return c.json({ recurringItem: item }, 201);
});

app.patch('/api/recurring/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<RecurringItemInput>>();
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    return c.json({ error: 'El nombre es obligatorio' }, 400);
  }
  if (body.amount !== undefined && (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0)) {
    return c.json({ error: 'El monto debe ser mayor a 0' }, 400);
  }
  if (
    body.day_of_month !== undefined &&
    body.day_of_month !== null &&
    (!Number.isInteger(body.day_of_month) || body.day_of_month < 1 || body.day_of_month > 31)
  ) {
    return c.json({ error: 'day_of_month debe ser un entero entre 1 y 31' }, 400);
  }
  if (
    body.start_month !== undefined &&
    body.start_month !== null &&
    body.start_month.trim() !== '' &&
    !isValidYearMonth(body.start_month.trim())
  ) {
    return c.json({ error: 'start_month inválido (formato esperado YYYY-MM)' }, 400);
  }

  const patch: Partial<RecurringItemInput> = { ...body };
  if (patch.account_id) {
    const targetAcc = await c.env.DB.prepare('SELECT * FROM accounts WHERE id = ?')
      .bind(patch.account_id)
      .first<Account>();
    if (!targetAcc) {
      return c.json({ error: 'La cuenta seleccionada no existe' }, 400);
    }
    patch.currency = targetAcc.currency;
  }

  const updated = await updateRecurringItem(c.env.DB, id, patch);
  if (!updated) {
    return c.json({ error: 'Gasto fijo no encontrado' }, 404);
  }
  return c.json({ recurringItem: updated });
});

app.delete('/api/recurring/:id', async (c) => {
  const id = c.req.param('id');
  const ok = await deleteRecurringItem(c.env.DB, id);
  if (!ok) {
    return c.json({ error: 'Gasto fijo no encontrado' }, 404);
  }
  return c.json({ ok: true });
});

app.get('/api/projection', async (c) => {
  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const startMonth =
    parseYearMonthParam(c.req.query('startMonth'), 'startMonth') ??
    addMonths(currentMonthInTimezone(tz), 1);
  const months = parseIntRangeParam(c.req.query('months'), 1, 12, 'months') ?? 3;
  const projection = await getFutureProjection(
    c.env.DB,
    startMonth,
    months,
    normalizeCurrency(c.env.DEFAULT_CURRENCY, 'ARS') ?? 'ARS'
  );
  return c.json(projection);
});

app.get('/api/export.csv', async (c) => {
  const month = parseYearMonthParam(c.req.query('month'), 'month');
  const from = parseIsoDateParam(c.req.query('from'), 'from');
  const to = parseIsoDateParam(c.req.query('to'), 'to');
  if (from && to && from > to) {
    throw new ValidationError('Rango de fechas inválido: from no puede ser posterior a to');
  }

  const [txs, accounts, categories] = await Promise.all([
    listTransactions(c.env.DB, { month, from, to, limit: 2500 }),
    listAccountsWithBalances(c.env.DB),
    listCategories(c.env.DB),
  ]);

  const accMap = new Map(accounts.map((a) => [a.id, a.name]));
  const catMap = new Map(categories.map((cat) => [cat.id, cat.name]));

  const csvEscape = (v: string | number | null | undefined) => {
    if (typeof v === 'number') {
      return Number.isFinite(v) ? String(v) : '0';
    }
    if (v === null || v === undefined) return '';
    const raw = String(v);
    const needsFormulaPrefix =
      /^[=+\-@\t\r]/.test(raw) || /^[=+\-@\t\r]/.test(raw.trimStart());
    const safe = needsFormulaPrefix ? `'${raw}` : raw;
    if (/[,"\n\r]/.test(safe)) {
      return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
  };

  const header = [
    'Fecha',
    'Tipo',
    'Monto',
    'Moneda',
    'Cuenta',
    'Cuenta Destino',
    'Categoría',
    'Descripción',
    'Etiquetas',
    'Cuotas',
    'Mes Resumen',
    'Mes Contable',
    'Tercero',
    'Origen',
  ];
  const rows = txs.map((tx) => [
    tx.occurred_at,
    tx.type,
    tx.amount,
    tx.currency,
    accMap.get(tx.account_id) ?? tx.account_id,
    tx.to_account_id ? (accMap.get(tx.to_account_id) ?? tx.to_account_id) : '',
    tx.category_id ? (catMap.get(tx.category_id) ?? tx.category_id) : '',
    tx.description,
    tx.tags.join('|'),
    tx.installments_total ?? '',
    tx.statement_month ?? '',
    tx.budget_month ?? '',
    tx.third_party_name ?? '',
    tx.source,
  ]);

  const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  const rawSuffix = from && to ? `-${from}_${to}` : month ? `-${month}` : '';
  const safeSuffix = rawSuffix.replace(/[^a-zA-Z0-9_-]/g, '');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gasti-movimientos${safeSuffix}.csv"`,
    },
  });
});

app.all('*', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
