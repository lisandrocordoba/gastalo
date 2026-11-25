import { describe, expect, it } from 'vitest';
import { isAuthorizedRequest, verifyTelegramInitData } from '../src/auth';
import {
  computeAccountBalances,
  computeFutureProjection,
  computeThirdPartyBalances,
} from '../src/db';
import { sanitizeParsedIntent } from '../src/gemini';
import { extractInstallments, mapWalletRows } from '../scripts/wallet-mapper.mjs';
import type { Account, RecurringItem } from '../src/types';
import {
  addMonths,
  arrayBufferToBase64,
  formatCurrency,
  getMonthDateRange,
  monthDiff,
  previousMonths,
  shortId,
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
});

describe('double-entry accounting v2 balances', () => {
  const accounts: Account[] = [
    { id: 'mp', name: 'Mercado Pago', type: 'wallet', currency: 'ARS', initial_balance: 100000, is_default: 1, created_at: '2026-01-01' },
    { id: 'mp_reservas', name: 'MP Reservas', type: 'savings', currency: 'ARS', initial_balance: 50000, is_default: 0, created_at: '2026-01-01' },
    { id: 'bbva_credito', name: 'TC BBVA', type: 'credit_card', currency: 'ARS', initial_balance: 0, is_default: 0, created_at: '2026-01-01' },
    { id: 'efectivo', name: 'Efectivo', type: 'cash', currency: 'ARS', initial_balance: 10000, is_default: 0, created_at: '2026-01-01' },
  ];

  it('handles BBVA negative credit card balance, card payment transfer, and reservas transfer', () => {
    const txs = [
      { type: 'income' as const, amount: 1000000, account_id: 'mp', to_account_id: null },
      { type: 'expense' as const, amount: 150000, account_id: 'bbva_credito', to_account_id: null },
      { type: 'expense' as const, amount: 4000, account_id: 'efectivo', to_account_id: null },
      { type: 'transfer' as const, amount: 300000, account_id: 'mp', to_account_id: 'mp_reservas' },
      { type: 'transfer' as const, amount: 150000, account_id: 'mp', to_account_id: 'bbva_credito' },
    ];

    const result = computeAccountBalances(accounts, txs);
    const byId = Object.fromEntries(result.map((a) => [a.id, a.balance]));

    expect(byId.mp).toBe(650000);
    expect(byId.mp_reservas).toBe(350000);
    expect(byId.bbva_credito).toBe(0);
    expect(byId.efectivo).toBe(6000);
  });

  it('handles investment, third-party split in installments, repayment to reservas, and adjustments', () => {
    const txs = [
      { type: 'expense' as const, amount: 22000, account_id: 'bbva_credito', to_account_id: null, third_party_name: null },
      { type: 'third_party' as const, amount: 22000, account_id: 'bbva_credito', to_account_id: null, third_party_name: 'Jere' },
      { type: 'third_party_repayment' as const, amount: 22000, account_id: 'mp', to_account_id: null, third_party_name: 'Jere' },
      { type: 'transfer' as const, amount: 22000, account_id: 'mp', to_account_id: 'mp_reservas', third_party_name: null },
      { type: 'investment' as const, amount: 80000, account_id: 'mp', to_account_id: null, third_party_name: null },
      { type: 'adjustment' as const, amount: -1500, account_id: 'efectivo', to_account_id: null, third_party_name: null },
      { type: 'adjustment' as const, amount: 500, account_id: 'efectivo', to_account_id: null, third_party_name: null },
    ];

    const balances = Object.fromEntries(
      computeAccountBalances(accounts, txs).map((a) => [a.id, a.balance])
    );
    expect(balances.bbva_credito).toBe(-44000);
    expect(balances.mp).toBe(20000);
    expect(balances.mp_reservas).toBe(72000);
    expect(balances.efectivo).toBe(9000);

    const tp = computeThirdPartyBalances(txs);
    expect(tp.total_pending).toBe(0);
    expect(tp.by_person).toEqual([]);
  });

  it('tracks remaining third-party balances when partially repaid', () => {
    const tp = computeThirdPartyBalances([
      { type: 'third_party', amount: 109341, third_party_name: 'Carlos' },
      { type: 'third_party_repayment', amount: 109000, third_party_name: 'carlos' },
      { type: 'third_party', amount: 15000, third_party_name: 'Mario' },
    ]);
    expect(tp.total_pending).toBe(15341);
    expect(tp.by_person).toEqual([
      { person: 'Mario', pending: 15000 },
      { person: 'Carlos', pending: 341 },
    ]);
  });
});

describe('future projection (installments + recurring vs reservas)', () => {
  it('projects overlapping installments and active recurring expenses against MP Reservas', () => {
    const txs = [
      {
        id: 't1',
        type: 'expense' as const,
        amount: 22000,
        currency: 'ARS',
        account_id: 'bbva_credito',
        description: 'Crocs papá (mi parte)',
        installments_total: 3,
        first_installment_month: '2026-12',
        third_party_name: null,
      },
      {
        id: 't2',
        type: 'third_party' as const,
        amount: 22000,
        currency: 'ARS',
        account_id: 'bbva_credito',
        description: 'Crocs papá (parte Jere)',
        installments_total: 3,
        first_installment_month: '2026-12',
        third_party_name: 'Jere',
      },
      {
        id: 't3',
        type: 'expense' as const,
        amount: 60000,
        currency: 'ARS',
        account_id: 'bbva_credito',
        description: 'Auriculares',
        installments_total: 2,
        first_installment_month: '2026-12',
        third_party_name: null,
      },
    ];

    const recurring: RecurringItem[] = [
      {
        id: 'r1',
        name: 'Tuenti',
        type: 'expense',
        amount: 12000,
        currency: 'ARS',
        account_id: 'mp',
        category_id: 'suscripciones_servicios',
        day_of_month: 5,
        active: 1,
        created_at: '2026-01-01',
      },
      {
        id: 'r2',
        name: 'Pausado',
        type: 'expense',
        amount: 50000,
        currency: 'ARS',
        account_id: 'mp',
        category_id: 'otros',
        day_of_month: 10,
        active: 0,
        created_at: '2026-01-01',
      },
    ];

    const proj = computeFutureProjection(txs, recurring, 60000, '2026-12', 3);
    expect(proj.months.map((m) => m.month)).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(proj.months[0].installments_total_amount).toBe(44666.66);
    expect(proj.months[0].recurring_total_amount).toBe(12000);
    expect(proj.months[0].total_committed).toBe(56666.66);
    expect(proj.next_month_coverage_delta).toBe(3333.34);
    expect(proj.months[2].installments_total_amount).toBe(14666.66);
    expect(proj.months[2].total_committed).toBe(26666.66);
  });
});

describe('gemini v2 intent sanitization', () => {
  const accounts = [
    { id: 'mp', type: 'wallet' as const },
    { id: 'mp_reservas', type: 'savings' as const },
    { id: 'efectivo', type: 'cash' as const },
    { id: 'bbva_credito', type: 'credit_card' as const },
    { id: 'bbva_credito_usd', type: 'credit_card' as const },
    { id: 'mp_credito', type: 'credit_card' as const },
  ];
  const categories = [
    { id: 'supermercado' },
    { id: 'kiosco_cafe' },
    { id: 'regalos' },
    { id: 'otros' },
    { id: 'otros_ingresos' },
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
            account_id: 'mp',
            category_id: 'otros',
            description: 'Compra BTC',
            occurred_at: '2026-11-25',
            tags: ['#BTC', 'Ahorro'],
          },
          {
            type: 'expense',
            amount: 44000,
            currency: 'ARS',
            account_id: 'bbva_credito',
            category_id: 'regalos',
            description: 'Crocs papá',
            occurred_at: '2026-11-25',
            tags: ['#Familia', 'familia'],
            installments_total: 3,
            third_party_name: 'Jere',
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

  it('routes USD BBVA card expenses to bbva_credito_usd and applies safe fallbacks', () => {
    const out = sanitizeParsedIntent(
      {
        intent: 'record',
        transactions: [
          {
            type: 'expense',
            amount: 5,
            currency: 'USD',
            account_id: 'bbva_credito',
            category_id: 'categoria_inexistente',
            description: 'Wallet premium',
            occurred_at: 'bad-date',
            tags: ['#Hormiga'],
            shared_third_party_amount: 10, // invalid >= amount
            third_party_name: 'Jere',
          },
          {
            type: 'expense',
            amount: 1000,
            currency: 'ARS',
            account_id: 'cuenta_inexistente',
            category_id: 'kiosco_cafe',
            description: 'Alfajor',
            occurred_at: '2026-11-25',
            tags: [],
          },
        ],
      },
      { accounts, categories, today: '2026-11-25' }
    );

    expect(out.transactions[0].account_id).toBe('bbva_credito_usd');
    expect(out.transactions[0].category_id).toBe('otros');
    expect(out.transactions[0].occurred_at).toBe('2026-11-25');
    expect(out.transactions[0].tags).toEqual(['hormiga']);
    expect(out.transactions[0].shared_third_party_amount).toBeNull();

    expect(out.transactions[1].account_id).toBe('mp');
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

describe('wallet .xls mapper', () => {
  it('extracts installments from card notes without matching single-installment labels', () => {
    expect(extractInstallments('Dental system: conducto y corona (6x105.440)')).toBe(6);
    expect(extractInstallments('Crocs german dia del padre(3x$14.666)')).toBe(3);
    expect(extractInstallments('Cargador celu (12x $2.750)')).toBe(12);
    expect(extractInstallments('Regalo inflador (2x54,6k)')).toBe(2);
    expect(extractInstallments('Pijama abril aniversario (1 cuota)')).toBeNull();
    expect(extractInstallments('Ssd (cuota 2/2)')).toBeNull();
  });

  it('pairs transfers, maps v2 categories/tags/investments/third-party, and balances to 0 diff', () => {
    const baseTs = Date.parse('2026-06-05T12:00:00Z');
    const result = mapWalletRows([
      {
        account: 'Mercado Pago',
        category: 'TRANSFER',
        currency: 'ARS',
        amount: -24483,
        type: 'Gastos',
        note: 'tarjeta 05/2026',
        labels: '',
        payee: '',
        transfer: 1,
        dateIso: '2026-06-05',
        isoTimestamp: '2026-06-05T12:00:00.000Z',
        timestampMs: baseTs,
      },
      {
        account: 'TC - BBVA',
        category: 'TRANSFER',
        currency: 'ARS',
        amount: 24483,
        type: 'Ingresos',
        note: 'tarjeta 05/2026',
        labels: '',
        payee: '',
        transfer: 1,
        dateIso: '2026-06-05',
        isoTimestamp: '2026-06-05T12:00:00.000Z',
        timestampMs: baseTs,
      },
      {
        account: 'Efectivo',
        category: 'TRANSFER',
        currency: 'ARS',
        amount: -14900,
        type: 'Gastos',
        note: 'Ajuste de saldo',
        labels: '',
        payee: '',
        transfer: 1,
        dateIso: '2026-04-01',
        isoTimestamp: '2026-04-01T12:00:00.000Z',
        timestampMs: Date.parse('2026-04-01T12:00:00Z'),
      },
      {
        account: 'Mercado Pago',
        category: 'Electrónica, accesorios',
        currency: 'ARS',
        amount: -160000,
        type: 'Gastos',
        note: 'HW: 4 ssd sata',
        labels: '',
        payee: '',
        transfer: 0,
        dateIso: '2026-06-30',
        isoTimestamp: '2026-06-30T12:00:00.000Z',
        timestampMs: Date.parse('2026-06-30T12:00:00Z'),
      },
      {
        account: 'Mercado Pago',
        category: 'Inversiones',
        currency: 'ARS',
        amount: -151100,
        type: 'Gastos',
        note: '0.00155 btc',
        labels: '',
        payee: '',
        transfer: 0,
        dateIso: '2026-06-18',
        isoTimestamp: '2026-06-18T12:00:00.000Z',
        timestampMs: Date.parse('2026-06-18T12:00:00Z'),
      },
      {
        account: 'TC - BBVA',
        category: 'Regalos, alegrías',
        currency: 'ARS',
        amount: -44000,
        type: 'Gastos',
        note: 'Crocs german (3x$14.666)',
        labels: 'familia|abril',
        payee: '',
        transfer: 0,
        dateIso: '2026-06-15',
        isoTimestamp: '2026-06-15T12:00:00.000Z',
        timestampMs: Date.parse('2026-06-15T12:00:00Z'),
      },
      {
        account: 'Mercado Pago',
        category: 'Gastos de Terceros',
        currency: 'ARS',
        amount: 22000,
        type: 'Ingresos',
        note: 'Parte jere crocs',
        labels: '',
        payee: '',
        transfer: 0,
        dateIso: '2026-06-15',
        isoTimestamp: '2026-06-15T12:00:00.000Z',
        timestampMs: Date.parse('2026-06-15T12:00:00Z'),
      },
    ]);

    expect(result.stats.paired_transfers).toBe(1);
    expect(result.stats.orphan_transfers_as_adjustments).toBe(1);
    expect(result.stats.mapped_transactions).toBe(6);

    const byDesc = Object.fromEntries(result.transactions.map((t) => [t.description, t]));
    expect(byDesc['tarjeta 05/2026'].type).toBe('transfer');
    expect(byDesc['tarjeta 05/2026'].account_id).toBe('mp');
    expect(byDesc['tarjeta 05/2026'].to_account_id).toBe('bbva_credito');
    expect(byDesc['Ajuste de saldo'].type).toBe('adjustment');
    expect(byDesc['Ajuste de saldo'].amount).toBe(-14900);
    expect(byDesc['HW: 4 ssd sata'].tags).toEqual(['hw']);
    expect(byDesc['0.00155 btc'].type).toBe('investment');
    expect(byDesc['Crocs german (3x$14.666)'].installments_total).toBe(3);
    expect(byDesc['Crocs german (3x$14.666)'].first_installment_month).toBe('2026-07');
    expect(byDesc['Crocs german (3x$14.666)'].tags).toEqual(['familia', 'abril']);
    expect(byDesc['Parte jere crocs'].type).toBe('third_party_repayment');
    expect(byDesc['Parte jere crocs'].third_party_name).toBe('Jere');

    for (const audit of result.balanceAudit) {
      expect(audit.diff).toBe(0);
    }
  });
});
