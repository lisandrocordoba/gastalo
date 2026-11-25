import { Hono } from 'hono';
import { verifyDashboardAuth } from './auth';
import {
  createTransaction,
  deleteTransaction,
  getMonthlyHistory,
  getMonthSummary,
  listAccountsWithBalances,
  listCategories,
  listTransactions,
  updateAccountInitialBalance,
  updateTransaction,
} from './db';
import { handleTelegramUpdate, type TelegramUpdate } from './telegram';
import type { Env, TransactionInput } from './types';
import { currentMonthInTimezone, todayInTimezone } from './utils';

const app = new Hono<{ Bindings: Env }>();

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
  const month = c.req.query('month') || currentMonthInTimezone(tz);

  const [categories, summary, monthlyHistory, transactions] = await Promise.all([
    listCategories(c.env.DB),
    getMonthSummary(c.env.DB, month),
    getMonthlyHistory(c.env.DB, month, 6),
    listTransactions(c.env.DB, { month, limit: 200 }),
  ]);

  return c.json({
    month,
    accounts: summary.accounts,
    categories,
    summary,
    monthlyHistory,
    transactions,
  });
});

app.get('/api/transactions', async (c) => {
  const txs = await listTransactions(c.env.DB, {
    month: c.req.query('month') || undefined,
    accountId: c.req.query('accountId') || undefined,
    categoryId: c.req.query('categoryId') || undefined,
    search: c.req.query('search') || undefined,
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : 200,
  });
  return c.json({ transactions: txs });
});

app.post('/api/transactions', async (c) => {
  const body = await c.req.json<Partial<TransactionInput>>();
  if (!body.type || !body.amount || body.amount <= 0 || !body.account_id || !body.description) {
    return c.json({ error: 'Datos inválidos' }, 400);
  }
  if (body.type === 'transfer' && (!body.to_account_id || body.to_account_id === body.account_id)) {
    return c.json({ error: 'Cuenta destino inválida para transferencia' }, 400);
  }

  const tz = c.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const tx = await createTransaction(c.env.DB, {
    type: body.type,
    amount: Number(body.amount),
    currency: body.currency || c.env.DEFAULT_CURRENCY || 'ARS',
    account_id: body.account_id,
    to_account_id: body.to_account_id ?? null,
    category_id: body.category_id ?? null,
    description: body.description.trim(),
    occurred_at: body.occurred_at || todayInTimezone(tz),
    source: 'web',
  });
  return c.json({ transaction: tx }, 201);
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

app.patch('/api/accounts/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ initial_balance?: number }>();
  if (typeof body.initial_balance !== 'number' || !Number.isFinite(body.initial_balance)) {
    return c.json({ error: 'initial_balance debe ser numérico' }, 400);
  }
  const updated = await updateAccountInitialBalance(c.env.DB, id, body.initial_balance);
  if (!updated) {
    return c.json({ error: 'Cuenta no encontrada' }, 404);
  }
  const accounts = await listAccountsWithBalances(c.env.DB);
  return c.json({ account: updated, accounts });
});

app.get('/api/export.csv', async (c) => {
  const month = c.req.query('month') || undefined;
  const [txs, accounts, categories] = await Promise.all([
    listTransactions(c.env.DB, { month, limit: 500 }),
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

  const header = ['Fecha', 'Tipo', 'Monto', 'Moneda', 'Cuenta', 'Cuenta Destino', 'Categoría', 'Descripción', 'Origen'];
  const rows = txs.map((tx) => [
    tx.occurred_at,
    tx.type,
    tx.amount,
    tx.currency,
    accMap.get(tx.account_id) ?? tx.account_id,
    tx.to_account_id ? (accMap.get(tx.to_account_id) ?? tx.to_account_id) : '',
    tx.category_id ? (catMap.get(tx.category_id) ?? tx.category_id) : '',
    tx.description,
    tx.source,
  ]);

  const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gasti-movimientos${month ? `-${month}` : ''}.csv"`,
    },
  });
});

app.all('*', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
