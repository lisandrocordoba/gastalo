import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAccount,
  createCategory,
  createRecurringItem,
  createTransaction,
  getTransactionById,
  listTags,
} from '../src/db';
import { handleTelegramUpdate, type TelegramUpdate } from '../src/telegram';
import type { Env } from '../src/types';
import { currentMonthInTimezone } from '../src/utils';
import { createTestD1 } from './helpers/d1Mock';

const { mockInteractionsCreate } = vi.hoisted(() => ({
  mockInteractionsCreate: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    interactions = {
      create: mockInteractionsCreate,
    };
  },
}));

const BOT_TOKEN = '123456:TEST_TELEGRAM_BOT_TOKEN';
const ALLOWED_USER_ID = '555111222';
const ALLOWED_USER_NUM = 555111222;
const TIMEZONE = 'America/Argentina/Buenos_Aires';

interface CapturedTgCall {
  method: string;
  body: Record<string, unknown> | undefined;
}

function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    ASSETS: { fetch: async () => new Response('Not Found', { status: 404 }) } as unknown as Fetcher,
    GEMINI_API_KEY: 'test-gemini-key',
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
    ALLOWED_TELEGRAM_USER_ID: ALLOWED_USER_ID,
    DASHBOARD_TOKEN: 'test-dashboard-token',
    DASHBOARD_URL: 'https://wallet.example.test',
    APP_ENV: 'production',
    DEFAULT_CURRENCY: 'ARS',
    TIMEZONE,
    ...overrides,
  };
}

function stubTelegramFetch(options: { fileBytes?: Uint8Array; filePath?: string } = {}): {
  calls: CapturedTgCall[];
} {
  const calls: CapturedTgCall[] = [];
  const filePath = options.filePath ?? 'voice/audio_1.ogg';
  const fileBytes = options.fileBytes ?? new Uint8Array([1, 2, 3, 4]);

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith(`https://api.telegram.org/file/bot${BOT_TOKEN}/`)) {
      return new Response(fileBytes, {
        status: 200,
        headers: { 'content-length': String(fileBytes.byteLength) },
      });
    }

    const prefix = `https://api.telegram.org/bot${BOT_TOKEN}/`;
    if (url.startsWith(prefix)) {
      const method = url.slice(prefix.length);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, body });

      if (method === 'getFile') {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { file_path: filePath, file_size: fileBytes.byteLength },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch URL in telegram test: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe('Telegram webhook handler integration', () => {
  let db: D1Database;
  let closeDb: () => void;
  let env: Env;
  let tgCalls: CapturedTgCall[];

  beforeEach(() => {
    const testD1 = createTestD1();
    db = testD1.db;
    closeDb = testD1.close;
    env = makeEnv(db);
    tgCalls = stubTelegramFetch().calls;
    mockInteractionsCreate.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    closeDb();
  });

  describe('security & access control (fail-closed)', () => {
    it('denies all updates without calling Telegram API when ALLOWED_TELEGRAM_USER_ID is unset, empty, or non-numeric', async () => {
      const update: TelegramUpdate = {
        update_id: 1,
        message: {
          message_id: 10,
          from: { id: ALLOWED_USER_NUM, first_name: 'Owner' },
          chat: { id: ALLOWED_USER_NUM },
          text: '/saldos',
        },
      };

      for (const badAllowed of ['', '   ', 'not-a-number', '0', '-5']) {
        await handleTelegramUpdate(makeEnv(db, { ALLOWED_TELEGRAM_USER_ID: badAllowed }), update);
      }
      expect(tgCalls).toHaveLength(0);
    });

    it('rejects group chat messages and callbacks even when from.id matches ALLOWED_TELEGRAM_USER_ID', async () => {
      const groupMsgUpdate: TelegramUpdate = {
        update_id: 2,
        message: {
          message_id: 11,
          from: { id: ALLOWED_USER_NUM },
          chat: { id: -100999888 },
          text: '/saldos',
        },
      };
      const groupCbUpdate: TelegramUpdate = {
        update_id: 3,
        callback_query: {
          id: 'cb_group_1',
          from: { id: ALLOWED_USER_NUM },
          message: {
            message_id: 12,
            chat: { id: -100999888 },
          },
          data: 'ok:fake_id',
        },
      };

      await handleTelegramUpdate(env, groupMsgUpdate);
      await handleTelegramUpdate(env, groupCbUpdate);
      expect(tgCalls).toHaveLength(0);
    });
  });

  describe('slash commands & multi-currency output', () => {
    it('normalizes @botname suffix and formats ARS, USD, BRL across /saldos, /resumen, /futuro, /cuentas, and /ultimos', async () => {
      const arsWallet = await createAccount(db, {
        name: 'Billetera ARS',
        type: 'wallet',
        currency: 'ARS',
        initial_balance: 50000,
        is_default: 1,
      });
      await createAccount(db, {
        name: 'Reservas ARS',
        type: 'savings',
        currency: 'ARS',
        initial_balance: 120000,
      });
      const usdWallet = await createAccount(db, {
        name: 'Cuenta USD',
        type: 'wallet',
        currency: 'USD',
        initial_balance: 300,
      });
      const brlWallet = await createAccount(db, {
        name: 'Cuenta BRL',
        type: 'wallet',
        currency: 'BRL',
        initial_balance: 450,
      });

      const currentMonth = currentMonthInTimezone(TIMEZONE);
      const todayDate = `${currentMonth}-05`;

      await createTransaction(db, {
        type: 'expense',
        amount: 2500,
        account_id: arsWallet.id,
        category_id: 'supermercado',
        description: 'Compras ARS',
        occurred_at: todayDate,
        source: 'web',
      });
      await createTransaction(db, {
        type: 'expense',
        amount: 25,
        account_id: usdWallet.id,
        category_id: 'suscripciones',
        description: 'Cloud USD',
        occurred_at: todayDate,
        source: 'web',
      });
      await createTransaction(db, {
        type: 'expense',
        amount: 40,
        account_id: brlWallet.id,
        category_id: 'delivery',
        description: 'Almuerzo BRL',
        occurred_at: todayDate,
        source: 'web',
      });
      await createRecurringItem(db, {
        name: 'Internet',
        type: 'expense',
        amount: 15000,
        account_id: arsWallet.id,
        start_month: currentMonth,
      });
      await createRecurringItem(db, {
        name: 'Streaming USD',
        type: 'expense',
        amount: 12,
        account_id: usdWallet.id,
        start_month: currentMonth,
      });
      await createRecurringItem(db, {
        name: 'Plan BRL',
        type: 'expense',
        amount: 35,
        account_id: brlWallet.id,
        start_month: currentMonth,
      });

      const sendCmd = async (text: string, msgId: number) => {
        await handleTelegramUpdate(env, {
          update_id: msgId,
          message: {
            message_id: msgId,
            from: { id: ALLOWED_USER_NUM },
            chat: { id: ALLOWED_USER_NUM },
            text,
          },
        });
      };

      await sendCmd('/saldos@mi_bot', 101);
      const saldosMsg = tgCalls.find((c) => c.method === 'sendMessage')?.body?.text as string;
      expect(saldosMsg).toContain('Saldos actuales');
      expect(saldosMsg).toContain('$ 47.500');
      expect(saldosMsg).toContain('US$ 275');
      expect(saldosMsg).toContain('R$ 410');

      tgCalls.length = 0;
      await sendCmd('/resumen', 102);
      const resumenMsg = tgCalls.find((c) => c.method === 'sendMessage')?.body?.text as string;
      expect(resumenMsg).toContain(`Resumen ${currentMonth}`);
      expect(resumenMsg).toContain('Gastos consumo:');
      expect(resumenMsg).toContain('US$ 25');
      expect(resumenMsg).toContain('R$ 40');

      tgCalls.length = 0;
      await sendCmd('/futuro', 103);
      const futuroMsg = tgCalls.find((c) => c.method === 'sendMessage')?.body?.text as string;
      expect(futuroMsg).toContain('Proyección próximos 3 meses');
      expect(futuroMsg).toContain('US$ 12');
      expect(futuroMsg).toContain('R$ 35');

      tgCalls.length = 0;
      await sendCmd('/cuentas', 104);
      const cuentasMsg = tgCalls.find((c) => c.method === 'sendMessage')?.body?.text as string;
      expect(cuentasMsg).toContain('Billetera ARS');
      expect(cuentasMsg).toContain('Cuenta USD');
      expect(cuentasMsg).toContain('Cuenta BRL');

      tgCalls.length = 0;
      await sendCmd('/ultimos', 105);
      const ultimosMsg = tgCalls.find((c) => c.method === 'sendMessage')?.body?.text as string;
      expect(ultimosMsg).toContain('Últimos movimientos');
      expect(ultimosMsg).toContain('Almuerzo BRL');
      expect(ultimosMsg).toContain('Cloud USD');
      expect(ultimosMsg).toContain('Compras ARS');
    });
  });

  describe('inline callbacks', () => {
    it('handles ok and del callbacks', async () => {
      const acc = await createAccount(db, {
        name: 'Wallet',
        type: 'wallet',
        currency: 'ARS',
        is_default: 1,
      });
      const tx = await createTransaction(db, {
        type: 'expense',
        amount: 1500,
        account_id: acc.id,
        category_id: 'kiosco',
        description: 'Alfajor',
        occurred_at: '2026-11-10',
        source: 'telegram_text',
      });

      await handleTelegramUpdate(env, {
        update_id: 201,
        callback_query: {
          id: 'cb_ok',
          from: { id: ALLOWED_USER_NUM },
          message: { message_id: 50, chat: { id: ALLOWED_USER_NUM } },
          data: `ok:${tx.id}`,
        },
      });
      const okEdit = tgCalls.find((c) => c.method === 'editMessageText')?.body;
      expect(String(okEdit?.text)).toContain('Confirmado');
      expect(tgCalls.some((c) => c.method === 'answerCallbackQuery')).toBe(true);

      tgCalls.length = 0;
      await handleTelegramUpdate(env, {
        update_id: 202,
        callback_query: {
          id: 'cb_del',
          from: { id: ALLOWED_USER_NUM },
          message: { message_id: 50, chat: { id: ALLOWED_USER_NUM } },
          data: `del:${tx.id}`,
        },
      });
      const delEdit = tgCalls.find((c) => c.method === 'editMessageText')?.body;
      expect(String(delEdit?.text)).toContain('Movimiento eliminado');
      expect(await getTransactionById(db, tx.id)).toBeNull();
    });

    it('handles catm -> cat callback and updates category in D1', async () => {
      const acc = await createAccount(db, {
        name: 'Wallet',
        type: 'wallet',
        currency: 'ARS',
        is_default: 1,
      });
      const tx = await createTransaction(db, {
        type: 'expense',
        amount: 4200,
        account_id: acc.id,
        category_id: 'otros',
        description: 'Café',
        occurred_at: '2026-11-10',
        source: 'telegram_text',
      });

      await handleTelegramUpdate(env, {
        update_id: 210,
        callback_query: {
          id: 'cb_catm',
          from: { id: ALLOWED_USER_NUM },
          message: { message_id: 51, chat: { id: ALLOWED_USER_NUM } },
          data: `catm:${tx.id}`,
        },
      });
      const catmEdit = tgCalls.find((c) => c.method === 'editMessageText')?.body;
      expect(String(catmEdit?.text)).toContain('Elegí la nueva categoría');

      tgCalls.length = 0;
      await handleTelegramUpdate(env, {
        update_id: 211,
        callback_query: {
          id: 'cb_cat',
          from: { id: ALLOWED_USER_NUM },
          message: { message_id: 51, chat: { id: ALLOWED_USER_NUM } },
          data: `cat:${tx.id}:kiosco`,
        },
      });
      const updated = await getTransactionById(db, tx.id);
      expect(updated?.category_id).toBe('kiosco');
    });

    it('handles accm -> acc callback, syncs currency on account change, and rejects incompatible transfer accounts', async () => {
      const ars1 = await createAccount(db, {
        name: 'ARS 1',
        type: 'wallet',
        currency: 'ARS',
        is_default: 1,
      });
      const ars2 = await createAccount(db, {
        name: 'ARS 2',
        type: 'savings',
        currency: 'ARS',
      });
      const usdAcc = await createAccount(db, {
        name: 'USD Acc',
        type: 'wallet',
        currency: 'USD',
      });

      const expenseTx = await createTransaction(db, {
        type: 'expense',
        amount: 100,
        account_id: ars1.id,
        category_id: 'compras',
        description: 'App store',
        occurred_at: '2026-11-10',
        source: 'telegram_text',
      });

      await handleTelegramUpdate(env, {
        update_id: 220,
        callback_query: {
          id: 'cb_accm',
          from: { id: ALLOWED_USER_NUM },
          message: { message_id: 52, chat: { id: ALLOWED_USER_NUM } },
          data: `accm:${expenseTx.id}`,
        },
      });
      expect(tgCalls.find((c) => c.method === 'editMessageText')?.body?.text).toContain('Elegí la cuenta');

      tgCalls.length = 0;
      await handleTelegramUpdate(env, {
        update_id: 221,
        callback_query: {
          id: 'cb_acc_usd',
          from: { id: ALLOWED_USER_NUM },
          message: { message_id: 52, chat: { id: ALLOWED_USER_NUM } },
          data: `acc:${expenseTx.id}:${usdAcc.id}`,
        },
      });
      const movedExpense = await getTransactionById(db, expenseTx.id);
      expect(movedExpense?.account_id).toBe(usdAcc.id);
      expect(movedExpense?.currency).toBe('USD');

      // Transfer incompatibility check
      const transferTx = await createTransaction(db, {
        type: 'transfer',
        amount: 5000,
        account_id: ars1.id,
        to_account_id: ars2.id,
        description: 'Ahorro',
        occurred_at: '2026-11-11',
        source: 'telegram_text',
      });

      tgCalls.length = 0;
      await handleTelegramUpdate(env, {
        update_id: 222,
        callback_query: {
          id: 'cb_acc_incompat',
          from: { id: ALLOWED_USER_NUM },
          message: { message_id: 53, chat: { id: ALLOWED_USER_NUM } },
          data: `acc:${transferTx.id}:${usdAcc.id}`,
        },
      });
      const answerCall = tgCalls.find((c) => c.method === 'answerCallbackQuery')?.body;
      expect(answerCall?.text).toBe('Cuenta incompatible para transferencia');
      const unchangedTransfer = await getTransactionById(db, transferTx.id);
      expect(unchangedTransfer?.account_id).toBe(ars1.id);
    });

    it('handles tagm -> tagt and legacy long-tag tagi (>40 chars) with all callback_data <= 64 UTF-8 bytes and no truncated duplicate tags', async () => {
      const acc = await createAccount(db, {
        name: 'Wallet',
        type: 'wallet',
        currency: 'ARS',
        is_default: 1,
      });
      const longTagId = 'legacy_etiqueta_historica_muy_larga_mas_de_cuarenta_chars';
      expect(longTagId.length).toBeGreaterThan(40);
      await db
        .prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)')
        .bind(longTagId, longTagId, '#71717a')
        .run();

      const tx = await createTransaction(db, {
        type: 'expense',
        amount: 3000,
        account_id: acc.id,
        category_id: 'compras',
        description: 'Item tag',
        occurred_at: '2026-11-12',
        source: 'telegram_text',
      });

      await handleTelegramUpdate(env, {
        update_id: 230,
        callback_query: {
          id: 'cb_tagm',
          from: { id: ALLOWED_USER_NUM },
          message: { message_id: 54, chat: { id: ALLOWED_USER_NUM } },
          data: `tagm:${tx.id}`,
        },
      });

      const editCall = tgCalls.find((c) => c.method === 'editMessageText')?.body;
      const replyMarkup = editCall?.reply_markup as {
        inline_keyboard: Array<Array<{ text: string; callback_data?: string }>>;
      };
      const allButtons = replyMarkup.inline_keyboard.flat();
      expect(allButtons.length).toBeGreaterThan(1);

      for (const btn of allButtons) {
        if (btn.callback_data) {
          expect(utf8ByteLength(btn.callback_data)).toBeLessThanOrEqual(64);
        }
      }

      const tagiButton = allButtons.find((b) => b.callback_data?.startsWith(`tagi:${tx.id}:`));
      const tagtCasaButton = allButtons.find((b) => b.callback_data === `tagt:${tx.id}:casa`);
      expect(tagiButton).toBeDefined();
      expect(tagtCasaButton).toBeDefined();

      // Toggle short tag via tagt
      tgCalls.length = 0;
      await handleTelegramUpdate(env, {
        update_id: 231,
        callback_query: {
          id: 'cb_tagt_casa',
          from: { id: ALLOWED_USER_NUM },
          message: { message_id: 54, chat: { id: ALLOWED_USER_NUM } },
          data: tagtCasaButton!.callback_data,
        },
      });
      const afterShort = await getTransactionById(db, tx.id);
      expect(afterShort?.tags).toContain('casa');

      // Toggle legacy >40-char tag via tagi
      tgCalls.length = 0;
      await handleTelegramUpdate(env, {
        update_id: 232,
        callback_query: {
          id: 'cb_tagi_long',
          from: { id: ALLOWED_USER_NUM },
          message: { message_id: 54, chat: { id: ALLOWED_USER_NUM } },
          data: tagiButton!.callback_data,
        },
      });

      const afterLong = await getTransactionById(db, tx.id);
      expect(afterLong?.tags).toContain(longTagId);

      const allTagsInDb = await listTags(db);
      const legacyRelated = allTagsInDb.filter((t) => t.id.startsWith('legacy_etiqueta'));
      expect(legacyRelated.map((t) => t.id)).toEqual([longTagId]);
    });
  });

  describe('deduplication, HTML escaping, and voice query flow', () => {
    it('deduplicates updates with an already-recorded telegram_message_id without calling Gemini', async () => {
      const acc = await createAccount(db, {
        name: 'Wallet',
        type: 'wallet',
        currency: 'ARS',
        is_default: 1,
      });
      await createTransaction(db, {
        type: 'expense',
        amount: 2000,
        account_id: acc.id,
        category_id: 'kiosco',
        description: 'Ya registrado',
        occurred_at: '2026-11-12',
        source: 'telegram_text',
        telegram_message_id: 888999,
      });

      await handleTelegramUpdate(env, {
        update_id: 301,
        message: {
          message_id: 888999,
          from: { id: ALLOWED_USER_NUM },
          chat: { id: ALLOWED_USER_NUM },
          text: 'Ya registrado 2000',
        },
      });

      expect(mockInteractionsCreate).not.toHaveBeenCalled();
      expect(tgCalls).toHaveLength(0);
    });

    it('escapes malicious HTML in category.icon when formatting transaction messages', async () => {
      const acc = await createAccount(db, {
        name: 'Wallet',
        type: 'wallet',
        currency: 'ARS',
        is_default: 1,
      });
      const xssCat = await createCategory(db, {
        name: 'XSS Cat',
        icon: '<script>alert(1)</script>',
        type: 'expense',
        color: '#ff0000',
      });
      const tx = await createTransaction(db, {
        type: 'expense',
        amount: 1000,
        account_id: acc.id,
        category_id: xssCat.id,
        description: 'Prueba XSS',
        occurred_at: '2026-11-12',
        source: 'telegram_text',
      });

      await handleTelegramUpdate(env, {
        update_id: 302,
        callback_query: {
          id: 'cb_xss_ok',
          from: { id: ALLOWED_USER_NUM },
          message: { message_id: 60, chat: { id: ALLOWED_USER_NUM } },
          data: `ok:${tx.id}`,
        },
      });

      const editBody = tgCalls.find((c) => c.method === 'editMessageText')?.body;
      const html = String(editBody?.text ?? '');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain('<script>');
    });

    it('uses transcribed_query from voice message instead of fallback prompt in answerFinancialQuery', async () => {
      const acc = await createAccount(db, {
        name: 'Wallet',
        type: 'wallet',
        currency: 'ARS',
        is_default: 1,
      });
      const currentMonth = currentMonthInTimezone(TIMEZONE);
      await createTransaction(db, {
        type: 'expense',
        amount: 12000,
        account_id: acc.id,
        category_id: 'compras',
        description: 'Teclado',
        occurred_at: `${currentMonth}-08`,
        source: 'web',
      });

      mockInteractionsCreate
        .mockResolvedValueOnce({
          output_text: JSON.stringify({
            intent: 'query',
            transcribed_query: '¿Cuánto gasté en Compras?',
            transactions: [],
            operations: [],
          }),
        })
        .mockResolvedValueOnce({
          output_text: 'Gastaste $ 12.000 en Compras este mes.',
        });

      await handleTelegramUpdate(env, {
        update_id: 303,
        message: {
          message_id: 9001,
          from: { id: ALLOWED_USER_NUM },
          chat: { id: ALLOWED_USER_NUM },
          voice: {
            file_id: 'voice_file_1',
            mime_type: 'audio/ogg',
            file_size: 4,
          },
        },
      });

      expect(mockInteractionsCreate).toHaveBeenCalledTimes(2);
      const secondCallArgs = mockInteractionsCreate.mock.calls[1][0] as { input: string };
      expect(secondCallArgs.input).toContain('¿Cuánto gasté en Compras?');
      expect(secondCallArgs.input).not.toContain('Resumen del mes');

      const sentMsg = tgCalls.find((c) => c.method === 'sendMessage')?.body?.text;
      expect(sentMsg).toBe('Gastaste $ 12.000 en Compras este mes.');
    });
  });
});
