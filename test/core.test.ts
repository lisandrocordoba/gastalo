import { describe, expect, it } from 'vitest';
import { isAuthorizedRequest, verifyTelegramInitData } from '../src/auth';
import { computeAccountBalances } from '../src/db';
import type { Account } from '../src/types';
import { arrayBufferToBase64, formatCurrency, getMonthDateRange, previousMonths, shortId } from '../src/utils';

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

  it('getMonthDateRange and previousMonths handle month boundaries', () => {
    expect(getMonthDateRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(previousMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('double-entry accounting balances', () => {
  const accounts: Account[] = [
    { id: 'mp', name: 'Mercado Pago', type: 'wallet', currency: 'ARS', initial_balance: 100000, is_default: 1, created_at: '2026-01-01' },
    { id: 'mp_reservas', name: 'MP Reservas', type: 'savings', currency: 'ARS', initial_balance: 50000, is_default: 0, created_at: '2026-01-01' },
    { id: 'bbva_credito', name: 'BBVA Crédito', type: 'credit_card', currency: 'ARS', initial_balance: 0, is_default: 0, created_at: '2026-01-01' },
    { id: 'efectivo', name: 'Efectivo', type: 'cash', currency: 'ARS', initial_balance: 10000, is_default: 0, created_at: '2026-01-01' },
  ];

  it('handles BBVA negative credit card balance, card payment transfer, and reservas transfer', () => {
    const txs = [
      // Sueldo en MP
      { type: 'income' as const, amount: 1000000, account_id: 'mp', to_account_id: null },
      // Compra con BBVA queda en negativo
      { type: 'expense' as const, amount: 150000, account_id: 'bbva_credito', to_account_id: null },
      // Compra en efectivo
      { type: 'expense' as const, amount: 4000, account_id: 'efectivo', to_account_id: null },
      // Paso a reservas (transferencia interna)
      { type: 'transfer' as const, amount: 300000, account_id: 'mp', to_account_id: 'mp_reservas' },
      // Pago de tarjeta BBVA desde MP
      { type: 'transfer' as const, amount: 150000, account_id: 'mp', to_account_id: 'bbva_credito' },
    ];

    const result = computeAccountBalances(accounts, txs);
    const byId = Object.fromEntries(result.map((a) => [a.id, a.balance]));

    expect(byId.mp).toBe(650000); // 100k + 1M - 300k - 150k
    expect(byId.mp_reservas).toBe(350000); // 50k + 300k
    expect(byId.bbva_credito).toBe(0); // 0 - 150k + 150k
    expect(byId.efectivo).toBe(6000); // 10k - 4k
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
