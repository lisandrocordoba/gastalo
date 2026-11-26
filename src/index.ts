import { Hono } from 'hono';
import { verifyDashboardAuth } from './auth';
import {
  ConflictError,
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
  getFutureProjection,
  getMonthlyHistory,
  getPeriodSummary,
  getTransactionsByIds,
  listAccountsWithBalances,
  listCategories,
  listRecurringItems,
  listTags,
  listTransactions,
  payCardStatement,
  reconcileAccountBalance,
  updateAccount,
  updateCategory,
  updateRecurringItem,
  updateTag,
  updateTransaction,
} from './db';
import { handleTelegramUpdate, type TelegramUpdate } from './telegram';
import type {
  AccountInput,
  AccountPatch,
  AccountingBasis,
  CategoryInput,
  CategoryPatch,
  Env,
  PayStatementInput,
  RecurringItemInput,
  SharedPurchaseInput,
  TagPatch,
  TransactionInput,
  TransactionType,
} from './types';
import { addMonths, currentMonthInTimezone, getMonthDateRange, todayInTimezone } from './utils';

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

app.get('/api/health', (c) => {
  return c.json({ ok: true, env: c.env.APP_ENV || 'production' });
});

app.post('/webhook/telegram', async (c) => {
  const expectedSecret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const incomingSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
    if (incomingSecret !== expectedSecret) {
      return c.json({ error: 'Forbidden' }, 403);
    }
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
  const month = c.req.query('month') || currentMonth;
  const fallbackRange = getMonthDateRange(month);
  const from = c.req.query('from') || fallbackRange.start;
  const to = c.req.query('to') || fallbackRange.end;
  const basis: AccountingBasis = c.req.query('basis') === 'accrual' ? 'accrual' : 'cash';
  const statementMonth = c.req.query('statementMonth') || currentMonth;
  const nextMonth = addMonths(currentMonth, 1);

  const defaultCurrency = c.env.DEFAULT_CURRENCY || 'ARS';
  const today = todayInTimezone(tz);
  const [categories, tags, summary, monthlyHistory, transactions, recurringItems, projection] =
    await Promise.all([
      listCategories(c.env.DB),
      listTags(c.env.DB),
      getPeriodSummary(c.env.DB, {
        from,
        to,
        basis,
        statementMonth,
        today,
      }),
      getMonthlyHistory(c.env.DB, { from, to, basis }),
      listTransactions(c.env.DB, { from, to, limit: 2500 }),
      listRecurringItems(c.env.DB),
      getFutureProjection(c.env.DB, nextMonth, 3, defaultCurrency),
    ]);

  const txIdSet = new Set(transactions.map((t) => t.id));
  const referencedIds = Array.from(
    new Set(
      summary.paid_statement_items
        .map((i) => i.transaction_id)
        .filter((id) => !txIdSet.has(id))
    )
  );
  const referencedTransactions = await getTransactionsByIds(c.env.DB, referencedIds);

  return c.json({
    month: from.slice(0, 7),
    from,
    to,
    basis,
    statementMonth,
    today,
    timezone: tz,
    accounts: summary.accounts,
    categories,
    tags,
    summary,
    monthlyHistory,
    transactions,
    referencedTransactions,
    recurringItems,
    projection,
    cardStatements: summary.card_statements,
    overdueStatements: summary.overdue_card_alerts,
  });
});

app.get('/api/transactions', async (c) => {
  const rawType = c.req.query('type') as TransactionType | undefined;
  const txs = await listTransactions(c.env.DB, {
    month: c.req.query('month') || undefined,
    from: c.req.query('from') || undefined,
    to: c.req.query('to') || undefined,
    accountId: c.req.query('accountId') || undefined,
    categoryId: c.req.query('categoryId') || undefined,
    tagId: c.req.query('tagId') || undefined,
    type: rawType && VALID_TX_TYPES.has(rawType) ? rawType : undefined,
    search: c.req.query('search') || undefined,
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : 500,
  });
  return c.json({ transactions: txs });
});

app.post('/api/transactions', async (c) => {
  const body = await c.req.json<Partial<TransactionInput>>();
  if (!body.type || !VALID_TX_TYPES.has(body.type) || !body.account_id || !body.description) {
    return c.json({ error: 'Datos inválidos' }, 400);
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || (body.type === 'adjustment' ? amount === 0 : amount <= 0)) {
    return c.json({ error: 'Monto inválido' }, 400);
  }
  if (body.type === 'transfer' && (!body.to_account_id || body.to_account_id === body.account_id)) {
    return c.json({ error: 'Cuenta destino inválida para transferencia' }, 400);
  }

  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const tx = await createTransaction(c.env.DB, {
    type: body.type,
    amount,
    currency: body.currency || c.env.DEFAULT_CURRENCY || 'ARS',
    account_id: body.account_id,
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
    !body.account_id ||
    !body.description ||
    !body.third_party_name ||
    typeof body.own_amount !== 'number' ||
    typeof body.third_party_amount !== 'number' ||
    body.own_amount < 0 ||
    body.third_party_amount <= 0
  ) {
    return c.json({ error: 'Datos inválidos para compra compartida' }, 400);
  }

  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const result = await createSharedPurchase(c.env.DB, {
    account_id: body.account_id,
    currency: body.currency || c.env.DEFAULT_CURRENCY || 'ARS',
    category_id: body.category_id ?? null,
    description: body.description,
    occurred_at: body.occurred_at || todayInTimezone(tz),
    own_amount: body.own_amount,
    third_party_amount: body.third_party_amount,
    third_party_name: body.third_party_name,
    installments_total: body.installments_total ?? null,
    first_installment_month: body.first_installment_month ?? null,
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
  if (!body.name || !body.name.trim() || !body.type) {
    return c.json({ error: 'Nombre y tipo de cuenta son obligatorios' }, 400);
  }
  if (
    body.due_day !== undefined &&
    body.due_day !== null &&
    (!Number.isInteger(body.due_day) || body.due_day < 1 || body.due_day > 31)
  ) {
    return c.json({ error: 'due_day debe ser un entero entre 1 y 31' }, 400);
  }
  try {
    const account = await createAccount(c.env.DB, {
      id: body.id,
      name: body.name,
      type: body.type,
      currency: body.currency || c.env.DEFAULT_CURRENCY || 'ARS',
      initial_balance: body.initial_balance,
      color: body.color,
      is_default: body.is_default,
      due_day: body.due_day ?? null,
    });
    const accounts = await listAccountsWithBalances(c.env.DB);
    return c.json({ account, accounts }, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Error creando cuenta' }, 400);
  }
});

app.patch('/api/accounts/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<AccountPatch>();
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
  try {
    const updated = await updateAccount(c.env.DB, id, body);
    if (!updated) {
      return c.json({ error: 'Cuenta no encontrada' }, 404);
    }
    const accounts = await listAccountsWithBalances(c.env.DB);
    return c.json({ account: updated, accounts });
  } catch (err) {
    if (err instanceof ConflictError) {
      return c.json({ error: err.message }, 409);
    }
    return c.json({ error: err instanceof Error ? err.message : 'Error actualizando cuenta' }, 400);
  }
});

app.delete('/api/accounts/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const ok = await deleteAccount(c.env.DB, id);
    if (!ok) {
      return c.json({ error: 'Cuenta no encontrada' }, 404);
    }
    const accounts = await listAccountsWithBalances(c.env.DB);
    return c.json({ ok: true, accounts });
  } catch (err) {
    if (err instanceof ConflictError) {
      return c.json({ error: err.message }, 409);
    }
    return c.json({ error: err instanceof Error ? err.message : 'Error eliminando cuenta' }, 400);
  }
});

app.post('/api/accounts/:id/reconcile', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ real_balance?: number; occurred_at?: string; description?: string }>();
  if (typeof body.real_balance !== 'number' || !Number.isFinite(body.real_balance)) {
    return c.json({ error: 'real_balance debe ser numérico' }, 400);
  }
  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  try {
    const result = await reconcileAccountBalance(
      c.env.DB,
      id,
      body.real_balance,
      body.occurred_at || todayInTimezone(tz),
      body.description
    );
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Error conciliando cuenta' }, 404);
  }
});

app.post('/api/cards/:id/pay-statement', async (c) => {
  const cardId = c.req.param('id');
  const body = await c.req.json<Partial<PayStatementInput>>();
  if (
    !body.statement_month ||
    !/^\d{4}-\d{2}$/.test(body.statement_month) ||
    typeof body.amount !== 'number' ||
    !Number.isFinite(body.amount) ||
    body.amount < 0
  ) {
    return c.json({ error: 'Datos inválidos para pago de resumen' }, 400);
  }
  const fees = typeof body.fees_amount === 'number' && body.fees_amount > 0 ? body.fees_amount : 0;
  if (body.amount + fees <= 0) {
    return c.json({ error: 'El total a pagar debe ser mayor a 0' }, 400);
  }

  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  try {
    const result = await payCardStatement(c.env.DB, {
      card_account_id: cardId,
      statement_month: body.statement_month,
      from_account_id: body.from_account_id || '',
      amount: body.amount,
      fees_amount: fees,
      occurred_at: body.occurred_at || todayInTimezone(tz),
      description: body.description,
    });
    return c.json(result, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Error al pagar resumen' }, 400);
  }
});

app.get('/api/categories', async (c) => {
  const categories = await listCategories(c.env.DB);
  return c.json({ categories });
});

app.post('/api/categories', async (c) => {
  const body = await c.req.json<Partial<CategoryInput>>();
  if (!body.name || !body.name.trim()) {
    return c.json({ error: 'Nombre de categoría obligatorio' }, 400);
  }
  try {
    const category = await createCategory(c.env.DB, {
      id: body.id,
      name: body.name,
      icon: body.icon || '📦',
      type: body.type || 'expense',
      color: body.color || '#9E9E9E',
    });
    const categories = await listCategories(c.env.DB);
    return c.json({ category, categories }, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Error creando categoría' }, 400);
  }
});

app.patch('/api/categories/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<CategoryPatch>();
  try {
    const updated = await updateCategory(c.env.DB, id, body);
    if (!updated) {
      return c.json({ error: 'Categoría no encontrada' }, 404);
    }
    const categories = await listCategories(c.env.DB);
    return c.json({ category: updated, categories });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Error actualizando categoría' }, 400);
  }
});

app.delete('/api/categories/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const ok = await deleteCategory(c.env.DB, id);
    if (!ok) {
      return c.json({ error: 'Categoría no encontrada' }, 404);
    }
    const categories = await listCategories(c.env.DB);
    return c.json({ ok: true, categories });
  } catch (err) {
    if (err instanceof ConflictError) {
      return c.json({ error: err.message }, 409);
    }
    return c.json({ error: err instanceof Error ? err.message : 'Error eliminando categoría' }, 400);
  }
});

app.get('/api/tags', async (c) => {
  const tags = await listTags(c.env.DB);
  return c.json({ tags });
});

app.post('/api/tags', async (c) => {
  const body = await c.req.json<{ name?: string; color?: string }>();
  if (!body.name || !body.name.trim()) {
    return c.json({ error: 'Nombre requerido' }, 400);
  }
  const tag = await createTag(c.env.DB, body.name, body.color || '#71717a');
  return c.json({ tag }, 201);
});

app.patch('/api/tags/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<TagPatch>();
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
  if (!body.name || !body.account_id || typeof body.amount !== 'number' || body.amount <= 0) {
    return c.json({ error: 'Datos inválidos' }, 400);
  }
  const accounts = await listAccountsWithBalances(c.env.DB);
  const acc = accounts.find((a) => a.id === body.account_id);
  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const startMonth =
    body.start_month === null
      ? null
      : typeof body.start_month === 'string' && /^\d{4}-\d{2}$/.test(body.start_month.trim())
        ? body.start_month.trim()
        : currentMonthInTimezone(tz);

  const item = await createRecurringItem(c.env.DB, {
    name: body.name,
    type: body.type === 'income' ? 'income' : 'expense',
    amount: body.amount,
    currency: body.currency || acc?.currency || c.env.DEFAULT_CURRENCY || 'ARS',
    account_id: body.account_id,
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
  const patch: Partial<RecurringItemInput> = { ...body };
  if (patch.account_id && !patch.currency) {
    const accounts = await listAccountsWithBalances(c.env.DB);
    const targetAcc = accounts.find((a) => a.id === patch.account_id);
    if (targetAcc) {
      patch.currency = targetAcc.currency;
    }
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
  const startMonth = c.req.query('startMonth') || addMonths(currentMonthInTimezone(tz), 1);
  const months = c.req.query('months') ? Math.min(12, Math.max(1, Number(c.req.query('months')))) : 3;
  const projection = await getFutureProjection(
    c.env.DB,
    startMonth,
    months,
    c.env.DEFAULT_CURRENCY || 'ARS'
  );
  return c.json(projection);
});

app.get('/api/export.csv', async (c) => {
  const month = c.req.query('month') || undefined;
  const from = c.req.query('from') || undefined;
  const to = c.req.query('to') || undefined;
  const [txs, accounts, categories] = await Promise.all([
    listTransactions(c.env.DB, { month, from, to, limit: 2500 }),
    listAccountsWithBalances(c.env.DB),
    listCategories(c.env.DB),
  ]);

  const accMap = new Map(accounts.map((a) => [a.id, a.name]));
  const catMap = new Map(categories.map((cat) => [cat.id, cat.name]));

  const csvEscape = (v: string | number | null | undefined) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
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
  const suffix = from && to ? `-${from}_${to}` : month ? `-${month}` : '';
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gasti-movimientos${suffix}.csv"`,
    },
  });
});

app.all('*', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
