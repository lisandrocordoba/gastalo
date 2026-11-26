import { describe, expect, it } from 'vitest';
import { isAuthorizedRequest, verifyTelegramInitData } from '../src/auth';
import {
  computeAccountBalances,
  computeCardStatements,
  computeFutureProjection,
  computeOverdueCardAlerts,
  computePeriodMetrics,
  computeSavingsBalance,
  computeThirdPartyBalances,
  pickDefaultLiquidAccount,
} from '../src/db';
import { sanitizeParsedIntent } from '../src/gemini';
import type { Account, Category, RecurringItem, Tag, Transaction } from '../src/types';
import {
  addMonths,
  arrayBufferToBase64,
  defaultColorForAccountType,
  formatCurrency,
  getMonthDateRange,
  monthDiff,
  previousMonths,
  shortId,
  slugifyId,
  slugifyTag,
} from '../src/utils';

describe('utils', () => {
  it('shortId generates 12-char hex strings', () => {
    const id = shortId();
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('arrayBufferToBase64 encodes binary buffers cleanly', () => {
    const bytes = new Uint8Array([72, 111, 108, 97]); // "Hola"
    expect(arrayBufferToBase64(bytes.buffer)).toBe('SG9sYQ==');
  });

  it('formatCurrency formats ARS and USD', () => {
    expect(formatCurrency(12500, 'ARS')).toBe('$ 12.500');
    expect(formatCurrency(-3500.5, 'ARS')).toBe('-$ 3.500,50');
    expect(formatCurrency(50, 'USD')).toBe('US$ 50');
  });

  it('getMonthDateRange, addMonths, monthDiff and previousMonths handle month boundaries', () => {
    expect(getMonthDateRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthDiff('2026-11', '2027-02')).toBe(3);
    expect(previousMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('slugifyTag normalizes accents, hashtags, and spaces', () => {
    expect(slugifyTag('#Hormiga')).toBe('hormiga');
    expect(slugifyTag('Vacaciones Año Nuevo')).toBe('vacaciones_ano_nuevo');
  });

  it('slugifyId and defaultColorForAccountType build agnostic account identifiers and colors', () => {
    expect(slugifyId('Banco Galicia (Sueldo)')).toBe('banco_galicia_sueldo');
    expect(slugifyId('Visa Crédito #1')).toBe('visa_credito_1');
    expect(defaultColorForAccountType('wallet')).toBe('#009EE3');
    expect(defaultColorForAccountType('savings')).toBe('#0EA5E9');
    expect(defaultColorForAccountType('cash')).toBe('#22C55E');
    expect(defaultColorForAccountType('credit_card')).toBe('#18181B');
  });
});

describe('agnostic account selection and savings aggregation', () => {
  it('picks default liquid account by currency and aggregates savings balances', () => {
    const customAccounts = [
      { id: 'visa', name: 'Visa', type: 'credit_card' as const, currency: 'ARS', initial_balance: 0, color: '#18181B', is_default: 0, created_at: '2026-01-01', balance: -50000 },
      { id: 'galicia', name: 'Galicia', type: 'wallet' as const, currency: 'ARS', initial_balance: 0, color: '#009EE3', is_default: 1, created_at: '2026-01-01', balance: 200000 },
      { id: 'ahorro_ars', name: 'Reserva ARS', type: 'savings' as const, currency: 'ARS', initial_balance: 0, color: '#0EA5E9', is_default: 0, created_at: '2026-01-01', balance: 60000 },
      { id: 'frasco_ars', name: 'Frasco Viaje', type: 'savings' as const, currency: 'ARS', initial_balance: 0, color: '#0EA5E9', is_default: 0, created_at: '2026-01-01', balance: 25000 },
      { id: 'ahorro_usd', name: 'Caja USD', type: 'savings' as const, currency: 'USD', initial_balance: 0, color: '#0EA5E9', is_default: 0, created_at: '2026-01-01', balance: 500 },
    ];

    expect(pickDefaultLiquidAccount(customAccounts, 'ARS')?.id).toBe('galicia');
    expect(pickDefaultLiquidAccount(customAccounts, 'USD')?.id).toBe('ahorro_usd');
    expect(pickDefaultLiquidAccount([customAccounts[0]])).toBeNull();
    expect(computeSavingsBalance(customAccounts, 'ARS')).toBe(85000);
    expect(computeSavingsBalance(customAccounts, 'USD')).toBe(500);
  });
});

describe('double-entry accounting v2 balances', () => {
  const accounts: Account[] = [
    { id: 'wallet_main', name: 'Billetera', type: 'wallet', currency: 'ARS', initial_balance: 100000, color: '#009EE3', is_default: 1, created_at: '2026-01-01' },
    { id: 'savings_main', name: 'Reservas', type: 'savings', currency: 'ARS', initial_balance: 50000, color: '#0EA5E9', is_default: 0, created_at: '2026-01-01' },
    { id: 'card_ars', name: 'Tarjeta Crédito', type: 'credit_card', currency: 'ARS', initial_balance: 0, color: '#18181B', is_default: 0, created_at: '2026-01-01' },
    { id: 'cash', name: 'Efectivo', type: 'cash', currency: 'ARS', initial_balance: 10000, color: '#22C55E', is_default: 0, created_at: '2026-01-01' },
  ];

  it('handles negative credit card balance, card payment transfer, and savings transfer', () => {
    const txs = [
      { type: 'income' as const, amount: 1000000, account_id: 'wallet_main', to_account_id: null },
      { type: 'expense' as const, amount: 150000, account_id: 'card_ars', to_account_id: null },
      { type: 'expense' as const, amount: 4000, account_id: 'cash', to_account_id: null },
      { type: 'transfer' as const, amount: 300000, account_id: 'wallet_main', to_account_id: 'savings_main' },
      { type: 'transfer' as const, amount: 150000, account_id: 'wallet_main', to_account_id: 'card_ars' },
    ];

    const result = computeAccountBalances(accounts, txs);
    const byId = Object.fromEntries(result.map((a) => [a.id, a.balance]));

    expect(byId.wallet_main).toBe(650000);
    expect(byId.savings_main).toBe(350000);
    expect(byId.card_ars).toBe(0);
    expect(byId.cash).toBe(6000);
  });

  it('handles investment, third-party split in installments, repayment to savings, and adjustments', () => {
    const txs = [
      { type: 'expense' as const, amount: 22000, account_id: 'card_ars', to_account_id: null, third_party_name: null },
      { type: 'third_party' as const, amount: 22000, account_id: 'card_ars', to_account_id: null, third_party_name: 'Ana' },
      { type: 'third_party_repayment' as const, amount: 22000, account_id: 'wallet_main', to_account_id: null, third_party_name: 'Ana' },
      { type: 'transfer' as const, amount: 22000, account_id: 'wallet_main', to_account_id: 'savings_main', third_party_name: null },
      { type: 'investment' as const, amount: 80000, account_id: 'wallet_main', to_account_id: null, third_party_name: null },
      { type: 'adjustment' as const, amount: -1500, account_id: 'cash', to_account_id: null, third_party_name: null },
      { type: 'adjustment' as const, amount: 500, account_id: 'cash', to_account_id: null, third_party_name: null },
    ];

    const balances = Object.fromEntries(
      computeAccountBalances(accounts, txs).map((a) => [a.id, a.balance])
    );
    expect(balances.card_ars).toBe(-44000);
    expect(balances.wallet_main).toBe(20000);
    expect(balances.savings_main).toBe(72000);
    expect(balances.cash).toBe(9000);

    const tp = computeThirdPartyBalances(txs);
    expect(tp.total_pending).toBe(0);
    expect(tp.by_person).toEqual([]);
  });

  it('tracks remaining third-party balances when partially repaid', () => {
    const tp = computeThirdPartyBalances([
      { type: 'third_party', amount: 109341, third_party_name: 'Luis' },
      { type: 'third_party_repayment', amount: 109000, third_party_name: 'luis' },
      { type: 'third_party', amount: 15000, third_party_name: 'Sofía' },
    ]);
    expect(tp.total_pending).toBe(15341);
    expect(tp.by_person).toEqual([
      { person: 'Sofía', pending: 15000 },
      { person: 'Luis', pending: 341 },
    ]);
  });
});

describe('future projection (installments + recurring vs savings)', () => {
  it('projects overlapping installments and active recurring expenses against savings balance', () => {
    const txs = [
      {
        id: 't1',
        type: 'expense' as const,
        amount: 22000,
        currency: 'ARS',
        account_id: 'card_ars',
        description: 'Regalo (mi parte)',
        installments_total: 3,
        first_installment_month: '2026-12',
        third_party_name: null,
      },
      {
        id: 't2',
        type: 'third_party' as const,
        amount: 22000,
        currency: 'ARS',
        account_id: 'card_ars',
        description: 'Regalo (parte Ana)',
        installments_total: 3,
        first_installment_month: '2026-12',
        third_party_name: 'Ana',
      },
      {
        id: 't3',
        type: 'expense' as const,
        amount: 60000,
        currency: 'ARS',
        account_id: 'card_ars',
        description: 'Auriculares',
        installments_total: 2,
        first_installment_month: '2026-12',
        third_party_name: null,
      },
    ];

    const recurring: RecurringItem[] = [
      {
        id: 'r1',
        name: 'Plan móvil',
        type: 'expense',
        amount: 12000,
        currency: 'ARS',
        account_id: 'wallet_main',
        category_id: 'suscripciones',
        day_of_month: 5,
        start_month: null,
        active: 1,
        created_at: '2026-01-01',
      },
      {
        id: 'r2',
        name: 'Pausado',
        type: 'expense',
        amount: 50000,
        currency: 'ARS',
        account_id: 'wallet_main',
        category_id: 'otros',
        day_of_month: 10,
        start_month: null,
        active: 0,
        created_at: '2026-01-01',
      },
      {
        id: 'r_future_ars',
        name: 'Seguro hogar',
        type: 'expense',
        amount: 10000,
        currency: 'ARS',
        account_id: 'wallet_main',
        category_id: 'servicios',
        day_of_month: 15,
        start_month: '2027-01',
        active: 1,
        created_at: '2026-12-01',
      },
      {
        id: 'r_usd',
        name: 'Suscripción USD',
        type: 'expense',
        amount: 5,
        currency: 'USD',
        account_id: 'card_ars',
        category_id: 'suscripciones',
        day_of_month: null,
        start_month: '2026-12',
        active: 1,
        created_at: '2026-12-01',
      },
    ];

    const proj = computeFutureProjection(txs, recurring, 60000, '2026-12', 3);
    expect(proj.months.map((m) => m.month)).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(proj.months[0].installments_total_amount).toBe(44666.66);
    expect(proj.months[0].recurring_total_amount).toBe(12000);
    expect(proj.months[0].recurring_usd_total_amount).toBe(5);
    expect(proj.months[0].total_committed).toBe(56666.66);
    expect(proj.next_month_coverage_delta).toBe(3333.34);
    expect(proj.months[1].recurring_total_amount).toBe(22000);
    expect(proj.months[2].installments_total_amount).toBe(14666.66);
    expect(proj.months[2].recurring_total_amount).toBe(22000);
    expect(proj.months[2].recurring_usd_total_amount).toBe(5);
    expect(proj.months[2].total_committed).toBe(36666.66);
  });
});

describe('agnostic gemini intent sanitization', () => {
  const accounts = [
    { id: 'galicia', type: 'wallet' as const, currency: 'ARS', is_default: 1 },
    { id: 'ahorro', type: 'savings' as const, currency: 'ARS', is_default: 0 },
    { id: 'efectivo', type: 'cash' as const, currency: 'ARS', is_default: 0 },
    { id: 'visa_ars', type: 'credit_card' as const, currency: 'ARS', is_default: 0 },
    { id: 'visa_usd', type: 'credit_card' as const, currency: 'USD', is_default: 0 },
  ];
  const categories = [
    { id: 'supermercado', type: 'expense' as const },
    { id: 'kiosco', type: 'expense' as const },
    { id: 'regalos', type: 'expense' as const },
    { id: 'otros', type: 'expense' as const },
    { id: 'otros_ingresos', type: 'income' as const },
  ];

  it('normalizes tags, investment category nulling, and next-month installment default on cards', () => {
    const out = sanitizeParsedIntent(
      {
        intent: 'record',
        transactions: [
          {
            type: 'investment',
            amount: 150000,
            currency: 'ARS',
            account_id: 'galicia',
            category_id: 'otros',
            description: 'Compra BTC',
            occurred_at: '2026-11-25',
            tags: ['#BTC', 'Ahorro'],
          },
          {
            type: 'expense',
            amount: 44000,
            currency: 'ARS',
            account_id: 'visa_ars',
            category_id: 'regalos',
            description: 'Regalo',
            occurred_at: '2026-11-25',
            tags: ['#Familia', 'familia'],
            installments_total: 3,
            third_party_name: 'Alex',
            shared_third_party_amount: 22000,
          },
        ],
      },
      { accounts, categories, today: '2026-11-25' }
    );

    expect(out.intent).toBe('record');
    expect(out.transactions).toHaveLength(2);
    expect(out.transactions[0].category_id).toBeNull();
    expect(out.transactions[0].tags).toEqual(['btc', 'ahorro']);

    expect(out.transactions[1].first_installment_month).toBe('2026-12');
    expect(out.transactions[1].tags).toEqual(['familia']);
    expect(out.transactions[1].shared_third_party_amount).toBe(22000);
  });

  it('routes USD card expenses to a USD credit card and falls back to is_default liquid account', () => {
    const out = sanitizeParsedIntent(
      {
        intent: 'record',
        transactions: [
          {
            type: 'expense',
            amount: 5,
            currency: 'USD',
            account_id: 'visa_ars',
            category_id: 'categoria_inexistente',
            description: 'App premium',
            occurred_at: 'bad-date',
            tags: ['#Hormiga'],
            shared_third_party_amount: 10, // invalid >= amount
            third_party_name: 'Alex',
          },
          {
            type: 'expense',
            amount: 1000,
            currency: 'ARS',
            account_id: 'cuenta_inexistente',
            category_id: 'kiosco',
            description: 'Alfajor',
            occurred_at: '2026-11-25',
            tags: [],
          },
          {
            type: 'transfer',
            amount: 20000,
            currency: 'ARS',
            account_id: 'galicia',
            to_account_id: 'galicia',
            description: 'Ahorro mensual',
            occurred_at: '2026-11-25',
            tags: [],
          },
        ],
      },
      { accounts, categories, today: '2026-11-25' }
    );

    expect(out.transactions[0].account_id).toBe('visa_usd');
    expect(out.transactions[0].category_id).toBe('otros');
    expect(out.transactions[0].occurred_at).toBe('2026-11-25');
    expect(out.transactions[0].tags).toEqual(['hormiga']);
    expect(out.transactions[0].shared_third_party_amount).toBeNull();

    expect(out.transactions[1].account_id).toBe('galicia');
    expect(out.transactions[2].to_account_id).toBe('ahorro');
    expect(out.transactions[2].statement_month).toBeNull();
  });

  it('populates statement_month automatically on card statement payment transfers via Telegram', () => {
    const out = sanitizeParsedIntent(
      {
        intent: 'record',
        transactions: [
          {
            type: 'transfer',
            amount: 120000,
            currency: 'ARS',
            account_id: 'galicia',
            to_account_id: 'visa_ars',
            description: 'Pago resumen Visa',
            occurred_at: '2026-11-10',
            tags: [],
          },
          {
            type: 'transfer',
            amount: 95000,
            currency: 'ARS',
            account_id: 'galicia',
            to_account_id: 'visa_ars',
            description: 'Pago resumen octubre',
            occurred_at: '2026-11-02',
            statement_month: '2026-10',
            tags: [],
          },
        ],
      },
      { accounts, categories, today: '2026-11-25' }
    );

    expect(out.transactions[0].statement_month).toBe('2026-11');
    expect(out.transactions[1].statement_month).toBe('2026-10');
  });

  it('returns empty transactions when accounts list is empty and sanitizes manage operations', () => {
    const emptyOut = sanitizeParsedIntent(
      {
        intent: 'record',
        transactions: [
          {
            type: 'expense',
            amount: 5000,
            currency: 'ARS',
            account_id: 'cualquiera',
            description: 'Café',
            occurred_at: '2026-11-25',
            tags: [],
          },
        ],
      },
      { accounts: [], categories, today: '2026-11-25' }
    );
    expect(emptyOut.transactions).toEqual([]);

    const manageOut = sanitizeParsedIntent(
      {
        intent: 'manage',
        operations: [
          {
            action: 'create_account',
            name: 'Visa Santander',
            account_type: 'credit_card',
            currency: 'usd',
            initial_balance: 0,
            is_default: true, // credit cards can never be default
            due_day: 10,
          },
          {
            action: 'create_account',
            name: 'Caja Ahorro',
            account_type: 'wallet',
            currency: 'ars',
            initial_balance: 0,
            is_default: false,
            due_day: 15, // ignored for non-card accounts
          },
          {
            action: 'create_category',
            name: 'Gimnasio',
            icon: '🏋️',
            category_type: 'expense',
            color: '#00E676',
          },
          {
            action: 'create_tag',
            name: '#Viaje',
            color: 'invalid-color',
          },
        ],
      },
      { accounts: [], categories, today: '2026-11-25' }
    );

    expect(manageOut.intent).toBe('manage');
    expect(manageOut.operations).toEqual([
      {
        action: 'create_account',
        name: 'Visa Santander',
        account_type: 'credit_card',
        currency: 'USD',
        initial_balance: 0,
        is_default: false,
        due_day: 10,
      },
      {
        action: 'create_account',
        name: 'Caja Ahorro',
        account_type: 'wallet',
        currency: 'ARS',
        initial_balance: 0,
        is_default: false,
        due_day: null,
      },
      {
        action: 'create_category',
        name: 'Gimnasio',
        icon: '🏋️',
        category_type: 'expense',
        color: '#00E676',
      },
      {
        action: 'create_tag',
        name: 'Viaje',
        color: '#71717a',
      },
    ]);
  });
});

describe('auth verification', () => {
  it('accepts valid Bearer token and rejects wrong token', async () => {
    const env = {
      APP_ENV: 'production',
      DASHBOARD_TOKEN: 'secret-123',
      TELEGRAM_BOT_TOKEN: 'bot-token',
      ALLOWED_TELEGRAM_USER_ID: '12345',
    };

    const ok = await isAuthorizedRequest(new Headers({ Authorization: 'Bearer secret-123' }), env);
    const bad = await isAuthorizedRequest(new Headers({ Authorization: 'Bearer wrong' }), env);
    expect(ok).toBe(true);
    expect(bad).toBe(false);
  });

  it('verifies valid Telegram WebApp initData HMAC-SHA256', async () => {
    const botToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
    const authDate = String(Math.floor(Date.now() / 1000));
    const userJson = JSON.stringify({ id: 998877, first_name: 'Lisandro' });

    const params = new URLSearchParams();
    params.set('auth_date', authDate);
    params.set('query_id', 'AAHdF6IQAAAAAN0XohDhrOrc');
    params.set('user', userJson);

    const pairs: string[] = [];
    params.forEach((v, k) => pairs.push(`${k}=${v}`));
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    const webAppKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const secret = await crypto.subtle.sign('HMAC', webAppKey, new TextEncoder().encode(botToken));
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      secret,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(dataCheckString));
    const hash = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    params.set('hash', hash);

    expect(await verifyTelegramInitData(params.toString(), botToken, '998877')).toBe(true);
    expect(await verifyTelegramInitData(params.toString(), botToken, '111111')).toBe(false);
  });
});

describe('credit card Opción B (cash flow on statement payment)', () => {
  const accounts: Account[] = [
    { id: 'wallet_main', name: 'Billetera', type: 'wallet', currency: 'ARS', initial_balance: 1000000, color: '#009EE3', is_default: 1, created_at: '2026-01-01' },
    { id: 'card_ars', name: 'Tarjeta Crédito', type: 'credit_card', currency: 'ARS', initial_balance: 0, color: '#18181B', is_default: 0, created_at: '2026-01-01' },
  ];
  const categories: Category[] = [
    { id: 'salud', name: 'Salud', icon: '💊', type: 'expense', color: '#26A69A' },
    { id: 'regalos', name: 'Regalos', icon: '🎁', type: 'expense', color: '#4FC3F7' },
    { id: 'otros', name: 'Otros / Trámites', icon: '📦', type: 'expense', color: '#9E9E9E' },
  ];
  const tags: Tag[] = [{ id: 'familia', name: 'familia', color: '#64DD17' }];

  const makeTx = (partial: Partial<Transaction> & Pick<Transaction, 'id' | 'type' | 'amount' | 'account_id' | 'description' | 'occurred_at'>): Transaction => ({
    currency: 'ARS',
    to_account_id: null,
    category_id: null,
    source: 'test',
    raw_input: null,
    telegram_message_id: null,
    installments_total: null,
    first_installment_month: null,
    statement_month: null,
    budget_month: null,
    third_party_name: null,
    linked_group_id: null,
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    ...partial,
  });

  it('keeps card purchase out of April cash expenses and reflects exact paid installment in May without duplication', () => {
    const txsBeforePayment: Transaction[] = [
      makeTx({
        id: 'dentist',
        type: 'expense',
        amount: 632640,
        account_id: 'card_ars',
        category_id: 'salud',
        description: 'Odontología',
        occurred_at: '2026-04-23',
        installments_total: 6,
        first_installment_month: '2026-05',
      }),
      makeTx({
        id: 'gift_own',
        type: 'expense',
        amount: 22000,
        account_id: 'card_ars',
        category_id: 'regalos',
        description: 'Regalo (mi parte)',
        occurred_at: '2026-04-25',
        installments_total: 2,
        first_installment_month: '2026-05',
        tags: ['familia'],
      }),
      makeTx({
        id: 'gift_third',
        type: 'third_party',
        amount: 22000,
        account_id: 'card_ars',
        description: 'Regalo (parte Ana)',
        occurred_at: '2026-04-25',
        installments_total: 2,
        first_installment_month: '2026-05',
        third_party_name: 'Ana',
      }),
    ];

    // April in cash mode: $0 card expenses, $654,640 own card purchases swiped, card debt is full -676,640
    const aprilCash = computePeriodMetrics(accounts, txsBeforePayment, categories, tags, {
      from: '2026-04-01',
      to: '2026-04-30',
      basis: 'cash',
      statementMonth: '2026-04',
    });
    expect(aprilCash.expense).toBe(0);
    expect(aprilCash.card_purchases).toBe(654640);
    expect(aprilCash.card_purchases_usd).toBe(0);
    expect(aprilCash.accounts.find((a) => a.id === 'wallet_main')?.balance).toBe(1000000);
    expect(aprilCash.accounts.find((a) => a.id === 'card_ars')?.balance).toBe(-676640);

    // April in accrual mode: shows own purchases (632640 + 22000 = 654640)
    const aprilAccrual = computePeriodMetrics(accounts, txsBeforePayment, categories, tags, {
      from: '2026-04-01',
      to: '2026-04-30',
      basis: 'accrual',
      statementMonth: '2026-04',
    });
    expect(aprilAccrual.expense).toBe(654640);

    // May statement before paying: pending 105440 + 11000 (own) + 11000 (Ana) = 127440
    const mayPending = computeCardStatements(accounts, txsBeforePayment, '2026-05')[0];
    expect(mayPending.status).toBe('pending');
    expect(mayPending.own_total).toBe(116440);
    expect(mayPending.third_party_total).toBe(11000);
    expect(mayPending.total_due).toBe(127440);

    // Before May 5 payment, May cash expense is still 0
    const mayBeforePay = computePeriodMetrics(accounts, txsBeforePayment, categories, tags, {
      from: '2026-05-01',
      to: '2026-05-31',
      basis: 'cash',
      statementMonth: '2026-05',
    });
    expect(mayBeforePay.expense).toBe(0);

    // User pays May statement on 2026-05-05 from liquid wallet
    const txsAfterPayment: Transaction[] = [
      ...txsBeforePayment,
      makeTx({
        id: 'pay_may',
        type: 'transfer',
        amount: 127440,
        account_id: 'wallet_main',
        to_account_id: 'card_ars',
        description: 'Pago resumen Tarjeta Crédito 2026-05',
        occurred_at: '2026-05-05',
        statement_month: '2026-05',
      }),
    ];

    const mayAfterPay = computePeriodMetrics(accounts, txsAfterPayment, categories, tags, {
      from: '2026-05-01',
      to: '2026-05-31',
      basis: 'cash',
      statementMonth: '2026-05',
    });

    // Wallet decreased by 127440, Card debt decreased by 127440 -> -549200
    expect(mayAfterPay.accounts.find((a) => a.id === 'wallet_main')?.balance).toBe(872560);
    expect(mayAfterPay.accounts.find((a) => a.id === 'card_ars')?.balance).toBe(-549200);
    // Personal cash expense equals own share only (105440 Salud + 11000 Regalos = 116440)
    expect(mayAfterPay.expense).toBe(116440);
    expect(mayAfterPay.card_purchases).toBe(0);
    expect(mayAfterPay.by_category.map((c) => [c.category_id, c.total])).toEqual([
      ['salud', 105440],
      ['regalos', 11000],
    ]);
    expect(mayAfterPay.by_tag.map((t) => [t.tag_id, t.total])).toEqual([['familia', 11000]]);
    expect(mayAfterPay.card_statements[0].status).toBe('paid');
  });

  it('allocates income with budget_month to the target accounting period without changing real balances', () => {
    const octSalary = makeTx({
      id: 'sal_oct',
      type: 'income',
      amount: 950000,
      account_id: 'wallet_main',
      category_id: 'sueldo',
      description: 'Sueldo',
      occurred_at: '2026-10-29',
      budget_month: '2026-11',
    });

    const oct = computePeriodMetrics(accounts, [octSalary], categories, tags, {
      from: '2026-10-01',
      to: '2026-10-31',
      basis: 'cash',
    });
    const nov = computePeriodMetrics(accounts, [octSalary], categories, tags, {
      from: '2026-11-01',
      to: '2026-11-30',
      basis: 'cash',
    });

    expect(oct.income).toBe(0);
    expect(nov.income).toBe(950000);
    expect(oct.accounts.find((a) => a.id === 'wallet_main')?.balance).toBe(1950000);
  });

  it('attaches active credit card recurring items respecting start_month and avoiding cross-month double matching', () => {
    const recurring: RecurringItem[] = [
      {
        id: 'rec_ai',
        name: 'Google AI Pro',
        type: 'expense',
        amount: 24000,
        currency: 'ARS',
        account_id: 'card_ars',
        category_id: 'suscripciones',
        day_of_month: 15,
        start_month: '2026-10',
        active: 1,
        created_at: '2026-01-01',
      },
      {
        id: 'rec_club',
        name: 'Cuota socio',
        type: 'expense',
        amount: 34800,
        currency: 'ARS',
        account_id: 'card_ars',
        category_id: 'deporte',
        day_of_month: 12,
        start_month: '2026-11',
        active: 1,
        created_at: '2026-01-01',
      },
    ];

    const txs = [
      makeTx({
        id: 'tx_ai_oct_swipe',
        type: 'expense',
        amount: 24000,
        account_id: 'card_ars',
        category_id: 'suscripciones',
        description: 'Google AI Pro',
        occurred_at: '2026-10-15',
        // No statement_month -> default dueMonth is next month (2026-11)
      }),
      makeTx({
        id: 'tx_club',
        type: 'expense',
        amount: 34800,
        account_id: 'card_ars',
        category_id: 'deporte',
        description: 'Cuota socio',
        occurred_at: '2026-11-12',
        statement_month: '2026-11',
      }),
    ];

    // Historical month before any start_month should show zero recurring items
    const aug = computeCardStatements(accounts, txs, '2026-08', recurring)[0];
    expect(aug.recurring_items).toHaveLength(0);

    // October matches only rec_ai (start_month 2026-10), and tx_ai_oct_swipe (due 2026-11) must NOT match October
    const oct = computeCardStatements(accounts, txs, '2026-10', recurring)[0];
    expect(oct.recurring_items).toHaveLength(1);
    expect(oct.recurring_items[0].recurring_id).toBe('rec_ai');
    expect(oct.recurring_items[0].posted_transaction_id).toBeNull();

    // November shows both and detects both posted transactions cleanly
    const nov = computeCardStatements(accounts, txs, '2026-11', recurring)[0];
    expect(nov.recurring_items).toHaveLength(2);
    expect(nov.recurring_items.find((r) => r.recurring_id === 'rec_club')?.posted_transaction_id).toBe('tx_club');
    expect(nov.recurring_items.find((r) => r.recurring_id === 'rec_ai')?.posted_transaction_id).toBe('tx_ai_oct_swipe');

    // December shows both as unposted templates
    const dec = computeCardStatements(accounts, txs, '2026-12', recurring)[0];
    expect(dec.recurring_items).toHaveLength(2);
    expect(dec.recurring_items.every((r) => r.posted_transaction_id === null)).toBe(true);
  });

  it('flags unpaid credit card statements as overdue only after due_day when total_due > 0', () => {
    const cardsWithDue: Account[] = [
      { ...accounts[0] },
      { ...accounts[1], due_day: 10 },
      { id: 'card_31', name: 'Visa 31', type: 'credit_card', currency: 'ARS', initial_balance: 0, color: '#18181B', is_default: 0, due_day: 31, created_at: '2026-01-01' },
    ];
    const txs = [
      makeTx({
        id: 'nov_charge',
        type: 'expense',
        amount: 50000,
        account_id: 'card_ars',
        category_id: 'otros',
        description: 'Compra octubre',
        occurred_at: '2026-10-18',
      }),
    ];

    expect(computeCardStatements(cardsWithDue, txs, '2026-11', [], '2026-11-09')[0].is_overdue).toBe(false);
    expect(computeCardStatements(cardsWithDue, txs, '2026-11', [], '2026-11-10')[0].is_overdue).toBe(false);
    const overdue = computeCardStatements(cardsWithDue, txs, '2026-11', [], '2026-11-11')[0];
    expect(overdue.due_day).toBe(10);
    expect(overdue.due_date).toBe('2026-11-10');
    expect(overdue.is_overdue).toBe(true);

    // Zero balance card should not be overdue even past due date
    const zeroCardFeb = computeCardStatements(cardsWithDue, txs, '2027-02', [], '2027-03-05')[1];
    expect(zeroCardFeb.due_date).toBe('2027-02-28');
    expect(zeroCardFeb.is_overdue).toBe(false);

    // Paid statement clears overdue state
    const paidTxs = [
      ...txs,
      makeTx({
        id: 'pay_nov',
        type: 'transfer',
        amount: 50000,
        account_id: 'wallet_main',
        to_account_id: 'card_ars',
        description: 'Pago resumen',
        occurred_at: '2026-11-12',
        statement_month: '2026-11',
      }),
    ];
    const afterPay = computeCardStatements(cardsWithDue, paidTxs, '2026-11', [], '2026-11-15')[0];
    expect(afterPay.status).toBe('paid');
    expect(afterPay.is_overdue).toBe(false);

    // Global period-independent alerts keep flagging 2026-11 even when viewing October 2026
    const octViewingWithOverdueNov = computePeriodMetrics(cardsWithDue, txs, categories, tags, {
      from: '2026-10-01',
      to: '2026-10-31',
      basis: 'cash',
      statementMonth: '2026-10',
      today: '2026-11-26',
    });
    expect(octViewingWithOverdueNov.overdue_card_alerts).toEqual([
      {
        account_id: 'card_ars',
        account_name: 'Tarjeta Crédito',
        currency: 'ARS',
        statement_month: '2026-11',
        due_date: '2026-11-10',
        total_due: 50000,
      },
    ]);
    expect(computeOverdueCardAlerts(cardsWithDue, paidTxs, '2026-11-26')).toEqual([]);

    // Older unpaid statement (e.g., 4+ months back in 2026-08) is also detected when viewing 2026-09 or 2026-11
    const oldUnpaidTxs = [
      ...paidTxs,
      makeTx({
        id: 'aug_charge',
        type: 'expense',
        amount: 12000,
        account_id: 'card_ars',
        category_id: 'otros',
        description: 'Compra julio',
        occurred_at: '2026-07-15',
        statement_month: '2026-08',
      }),
    ];
    const sepViewingWithOldOverdue = computePeriodMetrics(cardsWithDue, oldUnpaidTxs, categories, tags, {
      from: '2026-09-01',
      to: '2026-09-30',
      basis: 'cash',
      statementMonth: '2026-09',
      today: '2026-11-26',
    });
    expect(sepViewingWithOldOverdue.overdue_card_alerts).toEqual([
      {
        account_id: 'card_ars',
        account_name: 'Tarjeta Crédito',
        currency: 'ARS',
        statement_month: '2026-08',
        due_date: '2026-08-10',
        total_due: 12000,
      },
    ]);
  });
});
