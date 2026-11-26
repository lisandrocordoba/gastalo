import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index';
import type {
  AccountWithBalance,
  CardStatement,
  Env,
  MonthSummary,
  Transaction,
} from '../src/types';
import { createTestD1 } from './helpers/d1Mock';

const DASHBOARD_TOKEN = 'test-dashboard-token-secret';
const BOT_TOKEN = '123456:TEST_TELEGRAM_BOT_TOKEN';
const WEBHOOK_SECRET = 'test-webhook-secret-token';
const ALLOWED_USER_ID = '987654321';

function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    ASSETS: {
      fetch: async () => new Response('Not Found', { status: 404 }),
    } as unknown as Fetcher,
    GEMINI_API_KEY: 'test-gemini-key',
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ALLOWED_TELEGRAM_USER_ID: ALLOWED_USER_ID,
    DASHBOARD_TOKEN,
    DASHBOARD_URL: 'https://wallet.example.test',
    APP_ENV: 'production',
    DEFAULT_CURRENCY: 'ARS',
    TIMEZONE: 'America/Argentina/Buenos_Aires',
    ...overrides,
  };
}

function makeExecutionCtx(): {
  ctx: ExecutionContext;
  waitAll: () => Promise<unknown[]>;
} {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
    exports: {} as Cloudflare.Exports,
    props: {},
  } as unknown as ExecutionContext;
  return {
    ctx,
    waitAll: () => Promise.all(pending),
  };
}

async function buildSignedInitData(
  botToken: string,
  userId: string | number,
  options: { authDate?: number; includeAuthDate?: boolean } = {}
): Promise<string> {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify({ id: Number(userId), first_name: 'Tester' }));
  if (options.includeAuthDate !== false) {
    const authDate = options.authDate ?? Math.floor(Date.now() / 1000);
    params.set('auth_date', String(authDate));
  }

  const pairs: string[] = [];
  params.forEach((value, key) => {
    pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const encoder = new TextEncoder();
  const webAppKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const secretKeyBytes = await crypto.subtle.sign('HMAC', webAppKey, encoder.encode(botToken));
  const secretKey = await crypto.subtle.importKey(
    'raw',
    secretKeyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(dataCheckString));
  const hash = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  params.set('hash', hash);
  return params.toString();
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${DASHBOARD_TOKEN}`,
    ...extra,
  };
}

async function apiJson<T = Record<string, unknown>>(
  env: Env,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; data: T }> {
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization') && !headers.has('X-Telegram-Init-Data')) {
    headers.set('Authorization', `Bearer ${DASHBOARD_TOKEN}`);
  }
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await app.request(path, { ...init, headers }, env);
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

describe('Backend HTTP/D1 API integration', () => {
  let db: D1Database;
  let closeDb: () => void;
  let env: Env;

  beforeEach(() => {
    const testD1 = createTestD1();
    db = testD1.db;
    closeDb = testD1.close;
    env = makeEnv(db);
  });

  afterEach(() => {
    closeDb();
  });

  describe('D1 test mock integrity', () => {
    it('rolls back entire batch atomically when a later statement fails', async () => {
      const accountStmt = db
        .prepare(
          `INSERT INTO accounts (id, name, type, currency, initial_balance, color, is_default, due_day, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind('acc_rollback_ok', 'Rollback Test', 'wallet', 'ARS', 0, '#009EE3', 1, null, '2026-11-01T00:00:00.000Z');
      const invalidFkTxStmt = db
        .prepare(
          `INSERT INTO transactions (id, type, amount, currency, account_id, description, occurred_at, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind('tx_bad_fk', 'expense', 100, 'ARS', 'nonexistent_account', 'Should fail FK', '2026-11-01', 'web', '2026-11-01T00:00:00.000Z');

      await expect(db.batch([accountStmt, invalidFkTxStmt])).rejects.toThrow();

      const accAfter = await db
        .prepare('SELECT id FROM accounts WHERE id = ?')
        .bind('acc_rollback_ok')
        .first();
      expect(accAfter).toBeNull();
    });
  });

  describe('health, auth middleware, and telegram webhook secret', () => {
    it('allows GET /api/health without authentication', async () => {
      const res = await app.request('/api/health', {}, env);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, env: 'production' });
    });

    it('enforces Bearer token and signed Telegram initData fail-closed rules', async () => {
      const noAuth = await app.request('/api/accounts', {}, env);
      expect(noAuth.status).toBe(401);

      const wrongBearer = await app.request(
        '/api/accounts',
        { headers: { Authorization: 'Bearer invalid-token' } },
        env
      );
      expect(wrongBearer.status).toBe(401);

      const validBearer = await app.request(
        '/api/accounts',
        { headers: authHeaders() },
        env
      );
      expect(validBearer.status).toBe(200);

      const validInitData = await buildSignedInitData(BOT_TOKEN, ALLOWED_USER_ID);
      const validTg = await app.request(
        '/api/accounts',
        { headers: { 'X-Telegram-Init-Data': validInitData } },
        env
      );
      expect(validTg.status).toBe(200);

      const missingAuthDate = await buildSignedInitData(BOT_TOKEN, ALLOWED_USER_ID, {
        includeAuthDate: false,
      });
      const resMissingDate = await app.request(
        '/api/accounts',
        { headers: { 'X-Telegram-Init-Data': missingAuthDate } },
        env
      );
      expect(resMissingDate.status).toBe(401);

      const nowSec = Math.floor(Date.now() / 1000);
      const expiredInitData = await buildSignedInitData(BOT_TOKEN, ALLOWED_USER_ID, {
        authDate: nowSec - 90000,
      });
      const resExpired = await app.request(
        '/api/accounts',
        { headers: { 'X-Telegram-Init-Data': expiredInitData } },
        env
      );
      expect(resExpired.status).toBe(401);

      const futureInitData = await buildSignedInitData(BOT_TOKEN, ALLOWED_USER_ID, {
        authDate: nowSec + 600,
      });
      const resFuture = await app.request(
        '/api/accounts',
        { headers: { 'X-Telegram-Init-Data': futureInitData } },
        env
      );
      expect(resFuture.status).toBe(401);

      const emptyAllowedEnv = makeEnv(db, { ALLOWED_TELEGRAM_USER_ID: '' });
      const resEmptyAllowed = await app.request(
        '/api/accounts',
        { headers: { 'X-Telegram-Init-Data': validInitData } },
        emptyAllowedEnv
      );
      expect(resEmptyAllowed.status).toBe(401);
    });

    it('enforces TELEGRAM_WEBHOOK_SECRET fail-closed on POST /webhook/telegram', async () => {
      const noSecretEnv = makeEnv(db, { TELEGRAM_WEBHOOK_SECRET: '' });
      const { ctx: ctx1 } = makeExecutionCtx();
      const resUnset = await app.request(
        '/webhook/telegram',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
          },
          body: JSON.stringify({ update_id: 1 }),
        },
        noSecretEnv,
        ctx1
      );
      expect(resUnset.status).toBe(403);

      const { ctx: ctx2 } = makeExecutionCtx();
      const resWrong = await app.request(
        '/webhook/telegram',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret',
          },
          body: JSON.stringify({ update_id: 2 }),
        },
        env,
        ctx2
      );
      expect(resWrong.status).toBe(403);

      const { ctx: ctx3, waitAll } = makeExecutionCtx();
      const resOk = await app.request(
        '/webhook/telegram',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
          },
          body: JSON.stringify({ update_id: 3 }),
        },
        env,
        ctx3
      );
      expect(resOk.status).toBe(200);
      expect(await resOk.json()).toEqual({ ok: true });
      await waitAll();
    });
  });

  describe('full accounting & production-bug lifecycle', () => {
    it('supports ARS/USD/BRL accounts, rejects EUR, handles partial/full card statement payments without double-subtracting third_party_total, and reconciles bootstrap paid_statement_items', async () => {
      // 1. Create ARS, USD, BRL accounts and reject EUR
      const eurRes = await apiJson(env, '/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Euro Wallet',
          type: 'wallet',
          currency: 'EUR',
          initial_balance: 100,
        }),
      });
      expect(eurRes.status).toBe(400);

      const arsWalletRes = await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Cuenta Principal ARS',
          type: 'wallet',
          currency: 'ARS',
          initial_balance: 100000,
          is_default: 1,
        }),
      });
      expect(arsWalletRes.status).toBe(201);
      const arsWallet = arsWalletRes.data.account;

      const cardArsRes = await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Tarjeta Crédito ARS',
          type: 'credit_card',
          currency: 'ARS',
          due_day: 10,
        }),
      });
      expect(cardArsRes.status).toBe(201);
      const cardArs = cardArsRes.data.account;

      const usdRes = await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Caja USD',
          type: 'savings',
          currency: 'USD',
          initial_balance: 500,
        }),
      });
      expect(usdRes.status).toBe(201);
      expect(usdRes.data.account.currency).toBe('USD');

      const brlRes = await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Cuenta Brasil BRL',
          type: 'wallet',
          currency: 'BRL',
          initial_balance: 800,
        }),
      });
      expect(brlRes.status).toBe(201);
      expect(brlRes.data.account.currency).toBe('BRL');

      // 2. Create October card expenses (single-payment + multi-installment in Compras with #hw) + third_party
      const onePayRes = await apiJson<{ transaction: Transaction }>(env, '/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'expense',
          amount: 10000,
          account_id: cardArs.id,
          category_id: 'compras',
          description: 'Mouse inalámbrico',
          occurred_at: '2026-10-10',
          tags: ['hw'],
        }),
      });
      expect(onePayRes.status).toBe(201);
      const onePayTx = onePayRes.data.transaction;

      const instRes = await apiJson<{ transaction: Transaction }>(env, '/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'expense',
          amount: 30000,
          account_id: cardArs.id,
          category_id: 'compras',
          description: 'Monitor 27 pulgadas',
          occurred_at: '2026-10-15',
          installments_total: 3,
          first_installment_month: '2026-11',
          tags: ['hw'],
        }),
      });
      expect(instRes.status).toBe(201);
      const instTx = instRes.data.transaction;

      const thirdPartyRes = await apiJson<{ transaction: Transaction }>(env, '/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'third_party',
          amount: 5000,
          account_id: cardArs.id,
          description: 'Compra para amigo',
          occurred_at: '2026-10-20',
          third_party_name: 'Amigo',
        }),
      });
      expect(thirdPartyRes.status).toBe(201);

      // Total due on November 2026 statement: 10000 (1-pay) + 10000 (1/3) + 5000 (third_party) = 25000
      // 3. Partial payment #1: 15000 -> status 'partial', remaining_due = 10000
      const pay1Res = await apiJson<{
        transfer: Transaction;
        cardStatements: CardStatement[];
      }>(env, `/api/cards/${cardArs.id}/pay-statement`, {
        method: 'POST',
        body: JSON.stringify({
          statement_month: '2026-11',
          from_account_id: arsWallet.id,
          amount: 15000,
          occurred_at: '2026-11-10',
        }),
      });
      expect(pay1Res.status).toBe(201);
      const stmtAfterPay1 = pay1Res.data.cardStatements.find((s) => s.account_id === cardArs.id)!;
      expect(stmtAfterPay1.total_due).toBe(25000);
      expect(stmtAfterPay1.own_total).toBe(20000);
      expect(stmtAfterPay1.third_party_total).toBe(5000);
      expect(stmtAfterPay1.status).toBe('partial');
      expect(stmtAfterPay1.paid_amount).toBe(15000);
      expect(stmtAfterPay1.remaining_due).toBe(10000);

      // 4. Second payment for remaining 10000 -> status 'paid', remaining_due = 0
      const pay2Res = await apiJson<{
        transfer: Transaction;
        cardStatements: CardStatement[];
      }>(env, `/api/cards/${cardArs.id}/pay-statement`, {
        method: 'POST',
        body: JSON.stringify({
          statement_month: '2026-11',
          from_account_id: arsWallet.id,
          amount: 10000,
          occurred_at: '2026-11-20',
        }),
      });
      expect(pay2Res.status).toBe(201);
      const stmtAfterPay2 = pay2Res.data.cardStatements.find((s) => s.account_id === cardArs.id)!;
      expect(stmtAfterPay2.status).toBe('paid');
      expect(stmtAfterPay2.paid_amount).toBe(25000);
      expect(stmtAfterPay2.remaining_due).toBe(0);
      expect(stmtAfterPay2.paid_transaction_ids).toHaveLength(2);

      // 5. Bootstrap for November 2026 in cash mode
      const bootRes = await apiJson<{
        today: string;
        timezone: string;
        summary: MonthSummary;
        transactions: Transaction[];
        referencedTransactions: Transaction[];
      }>(env, '/api/bootstrap?from=2026-11-01&to=2026-11-30&basis=cash&statementMonth=2026-11');
      expect(bootRes.status).toBe(200);

      const { today, timezone, summary, transactions, referencedTransactions } = bootRes.data;
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(timezone).toBe('America/Argentina/Buenos_Aires');

      // third_party_total (5000) was absorbed once on pay1, so own counted across pay1 (10000) + pay2 (10000) = 20000
      expect(summary.expense).toBe(20000);

      const paidItemsSum = summary.paid_statement_items.reduce((s, i) => s + i.prorated_amount, 0);
      expect(paidItemsSum).toBe(20000);
      expect(summary.paid_statement_items.every((i) => i.category_id === 'compras')).toBe(true);
      expect(summary.paid_statement_items.every((i) => i.tags.includes('hw'))).toBe(true);

      const comprasTotal = summary.by_category.find((c) => c.category_id === 'compras')?.total;
      const hwTotal = summary.by_tag.find((t) => t.tag_id === 'hw')?.total;
      expect(comprasTotal).toBe(20000);
      expect(hwTotal).toBe(20000);

      // Source October card transactions are outside Nov 1..30 so they appear in referencedTransactions
      expect(transactions.some((t) => t.id === onePayTx.id)).toBe(false);
      expect(transactions.some((t) => t.id === instTx.id)).toBe(false);
      const refIds = new Set(referencedTransactions.map((t) => t.id));
      expect(refIds.has(onePayTx.id)).toBe(true);
      expect(refIds.has(instTx.id)).toBe(true);
    });
  });

  describe('hardening and error paths (400 / 404 / 409)', () => {
    it('rejects mismatched currency, cross-currency transfer, invalid calendar date, and malformed JSON on POST /api/transactions', async () => {
      const arsAcc = (
        await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'ARS Wallet', type: 'wallet', currency: 'ARS' }),
        })
      ).data.account;
      const usdAcc = (
        await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'USD Wallet', type: 'wallet', currency: 'USD' }),
        })
      ).data.account;

      const mismatchRes = await apiJson(env, '/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'expense',
          amount: 100,
          currency: 'USD',
          account_id: arsAcc.id,
          description: 'Mismatched currency',
          occurred_at: '2026-11-05',
        }),
      });
      expect(mismatchRes.status).toBe(400);

      const crossTransferRes = await apiJson(env, '/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'transfer',
          amount: 100,
          account_id: arsAcc.id,
          to_account_id: usdAcc.id,
          description: 'Cross currency transfer',
          occurred_at: '2026-11-05',
        }),
      });
      expect(crossTransferRes.status).toBe(400);

      const badDateRes = await apiJson(env, '/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'expense',
          amount: 100,
          account_id: arsAcc.id,
          description: 'Impossible Feb date',
          occurred_at: '2026-02-31',
        }),
      });
      expect(badDateRes.status).toBe(400);

      const malformedRes = await app.request(
        '/api/transactions',
        {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: '{invalid-json',
        },
        env
      );
      expect(malformedRes.status).toBe(400);
    });

    it('auto-syncs currency, cleans stale type fields, and validates fields on PATCH /api/transactions/:id', async () => {
      const cardArs = (
        await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'Card ARS', type: 'credit_card', currency: 'ARS' }),
        })
      ).data.account;
      const usdWallet = (
        await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'Wallet USD', type: 'wallet', currency: 'USD' }),
        })
      ).data.account;

      const createdRes = await apiJson<{ transaction: Transaction }>(env, '/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'third_party',
          amount: 12000,
          account_id: cardArs.id,
          description: 'Compra cuotas tercero',
          occurred_at: '2026-11-05',
          third_party_name: 'Carlos',
          installments_total: 3,
          first_installment_month: '2026-12',
        }),
      });
      expect(createdRes.status).toBe(201);
      const tx = createdRes.data.transaction;
      expect(tx.currency).toBe('ARS');
      expect(tx.third_party_name).toBe('Carlos');
      expect(tx.installments_total).toBe(3);

      // Change account_id to USD wallet AND type to investment -> currency becomes USD and stale fields clear
      const patchRes = await apiJson<{ transaction: Transaction }>(env, `/api/transactions/${tx.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          account_id: usdWallet.id,
          type: 'investment',
        }),
      });
      expect(patchRes.status).toBe(200);
      expect(patchRes.data.transaction.currency).toBe('USD');
      expect(patchRes.data.transaction.type).toBe('investment');
      expect(patchRes.data.transaction.third_party_name).toBeNull();
      expect(patchRes.data.transaction.installments_total).toBeNull();
      expect(patchRes.data.transaction.first_installment_month).toBeNull();

      // Reject invalid values
      const badAmount = await apiJson(env, `/api/transactions/${tx.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ amount: -50 }),
      });
      expect(badAmount.status).toBe(400);

      const badDate = await apiJson(env, `/api/transactions/${tx.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ occurred_at: '2026-02-30' }),
      });
      expect(badDate.status).toBe(400);
    });

    it('rejects cross-currency statement payment and succeeds with fees_amount > 0 even after deleting category otros', async () => {
      const arsWallet = (
        await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'ARS Wallet', type: 'wallet', currency: 'ARS', initial_balance: 50000 }),
        })
      ).data.account;
      const usdWallet = (
        await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'USD Wallet', type: 'wallet', currency: 'USD', initial_balance: 500 }),
        })
      ).data.account;
      const cardArs = (
        await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'Visa ARS', type: 'credit_card', currency: 'ARS' }),
        })
      ).data.account;

      const crossPay = await apiJson(env, `/api/cards/${cardArs.id}/pay-statement`, {
        method: 'POST',
        body: JSON.stringify({
          statement_month: '2026-11',
          from_account_id: usdWallet.id,
          amount: 10000,
          occurred_at: '2026-11-10',
        }),
      });
      expect(crossPay.status).toBe(400);

      const delOtros = await apiJson(env, '/api/categories/otros', { method: 'DELETE' });
      expect(delOtros.status).toBe(200);

      const payWithFees = await apiJson<{ transfer: Transaction; feesTx: Transaction | null }>(
        env,
        `/api/cards/${cardArs.id}/pay-statement`,
        {
          method: 'POST',
          body: JSON.stringify({
            statement_month: '2026-11',
            from_account_id: arsWallet.id,
            amount: 10000,
            fees_amount: 850,
            occurred_at: '2026-11-10',
          }),
        }
      );
      expect(payWithFees.status).toBe(201);
      expect(payWithFees.data.feesTx).not.toBeNull();
      expect(payWithFees.data.feesTx?.amount).toBe(850);
      expect(payWithFees.data.feesTx?.category_id).toBeNull();
      expect(payWithFees.data.transfer.amount).toBe(10850);
    });

    it('returns 409 on DELETE /api/accounts/:id when referenced by transactions', async () => {
      const acc = (
        await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'Referenced Wallet', type: 'wallet', currency: 'ARS' }),
        })
      ).data.account;

      await apiJson(env, '/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'expense',
          amount: 500,
          account_id: acc.id,
          description: 'Coffee',
          occurred_at: '2026-11-02',
        }),
      });

      const delRes = await apiJson(env, `/api/accounts/${acc.id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(409);
    });

    it('syncs currency on PATCH /api/recurring/:id when changing account_id even if stale currency is passed', async () => {
      const arsAcc = (
        await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'ARS Acc', type: 'wallet', currency: 'ARS' }),
        })
      ).data.account;
      const usdAcc = (
        await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'USD Acc', type: 'wallet', currency: 'USD' }),
        })
      ).data.account;

      const created = await apiJson<{ recurringItem: { id: string; currency: string } }>(
        env,
        '/api/recurring',
        {
          method: 'POST',
          body: JSON.stringify({
            name: 'Cloud Hosting',
            type: 'expense',
            amount: 20,
            account_id: arsAcc.id,
            start_month: '2026-11',
          }),
        }
      );
      expect(created.status).toBe(201);
      expect(created.data.recurringItem.currency).toBe('ARS');

      const patched = await apiJson<{
        recurringItem: { id: string; account_id: string; currency: string };
      }>(env, `/api/recurring/${created.data.recurringItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          account_id: usdAcc.id,
          currency: 'ARS', // stale currency
        }),
      });
      expect(patched.status).toBe(200);
      expect(patched.data.recurringItem.account_id).toBe(usdAcc.id);
      expect(patched.data.recurringItem.currency).toBe('USD');
    });

    it('returns 404 on reconcile for nonexistent account and creates adjustment transaction on valid account', async () => {
      const missingRes = await apiJson(env, '/api/accounts/nonexistent_id/reconcile', {
        method: 'POST',
        body: JSON.stringify({ real_balance: 5000, occurred_at: '2026-11-15' }),
      });
      expect(missingRes.status).toBe(404);

      const acc = (
        await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'Cash Box', type: 'cash', currency: 'ARS', initial_balance: 1000 }),
        })
      ).data.account;

      const recRes = await apiJson<{
        adjustment: Transaction | null;
        accounts: AccountWithBalance[];
      }>(env, `/api/accounts/${acc.id}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({ real_balance: 1750, occurred_at: '2026-11-15' }),
      });
      expect(recRes.status).toBe(200);
      expect(recRes.data.adjustment).not.toBeNull();
      expect(recRes.data.adjustment?.type).toBe('adjustment');
      expect(recRes.data.adjustment?.amount).toBe(750);
      expect(recRes.data.accounts.find((a) => a.id === acc.id)?.balance).toBe(1750);
    });

    it('neutralizes spreadsheet formula injection in GET /api/export.csv', async () => {
      const acc = (
        await apiJson<{ account: AccountWithBalance }>(env, '/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'CSV Wallet', type: 'wallet', currency: 'ARS' }),
        })
      ).data.account;

      const payloads = ['=SUM(A1)', '+cmd', '-1+1', '@evil'];
      for (const desc of payloads) {
        const res = await apiJson(env, '/api/transactions', {
          method: 'POST',
          body: JSON.stringify({
            type: 'expense',
            amount: 100,
            account_id: acc.id,
            description: desc,
            occurred_at: '2026-11-12',
          }),
        });
        expect(res.status).toBe(201);
      }

      const csvRes = await app.request(
        '/api/export.csv?from=2026-11-01&to=2026-11-30',
        { headers: authHeaders() },
        env
      );
      expect(csvRes.status).toBe(200);
      const csvText = await csvRes.text();
      expect(csvText).toContain("'=SUM(A1)");
      expect(csvText).toContain("'+cmd");
      expect(csvText).toContain("'-1+1");
      expect(csvText).toContain("'@evil");
    });
  });
});
