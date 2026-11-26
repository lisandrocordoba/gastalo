import { describe, expect, it } from 'vitest';
import type {
  AccountWithBalance,
  MonthProjection,
  MonthSummary,
  PaidStatementItem,
  Transaction,
} from '../web/src/types';
import {
  buildCurrentStatusMetrics,
  buildProjectionMonthMeta,
  buildProjectionTitle,
  buildSummarySubtitles,
} from '../web/src/utils/dashboardViewModel';
import { defaultCardStatementMonth } from '../web/src/utils/cardDates';
import { formatMoney } from '../web/src/utils/format';
import {
  effectiveTransactionDate,
  filterPaidStatementItems,
  filterTransactions,
  sortTransactions,
  type TransactionFilterOptions,
} from '../web/src/utils/transactionFilters';

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx_1',
    type: 'expense',
    amount: 1000,
    currency: 'ARS',
    account_id: 'acc_wallet_1',
    to_account_id: null,
    category_id: 'comida',
    description: 'Movimiento prueba',
    occurred_at: '2026-11-10',
    source: 'web',
    installments_total: null,
    first_installment_month: null,
    statement_month: null,
    budget_month: null,
    third_party_name: null,
    linked_group_id: null,
    tags: [],
    created_at: '2026-11-10T12:00:00Z',
    ...overrides,
  };
}

function makePaidItem(overrides: Partial<PaidStatementItem> = {}): PaidStatementItem {
  return {
    transaction_id: 'tx_card_1',
    payment_transaction_id: 'tx_pay_nov',
    card_account_id: 'acc_card_1',
    card_account_name: 'Tarjeta Principal',
    statement_month: '2026-11',
    paid_at: '2026-11-05',
    occurred_at: '2026-10-18',
    description: 'Compra tarjeta',
    category_id: 'compras',
    tags: [],
    installment_number: 1,
    installments_total: 1,
    installment_amount: 1000,
    prorated_amount: 1000,
    currency: 'ARS',
    ...overrides,
  };
}

function makeAccount(overrides: Partial<AccountWithBalance> = {}): AccountWithBalance {
  return {
    id: 'acc_1',
    name: 'Cuenta Principal',
    type: 'wallet',
    currency: 'ARS',
    initial_balance: 0,
    color: '#009EE3',
    is_default: 0,
    due_day: null,
    balance: 0,
    ...overrides,
  };
}

function makeFilterOptions(
  overrides: Partial<TransactionFilterOptions> = {}
): TransactionFilterOptions {
  return {
    cardAccountIds: new Set(['acc_card_1', 'acc_card_2']),
    cardPurchasesOnly: false,
    selectedAccount: '',
    selectedCategory: '',
    typeFilter: '',
    selectedTag: '',
    search: '',
    ...overrides,
  };
}

describe('transactionFilters — paid statement attribution regression', () => {
  const novPaymentTransfer = makeTransaction({
    id: 'tx_pay_nov',
    type: 'transfer',
    amount: 250393,
    account_id: 'acc_wallet_1',
    to_account_id: 'acc_card_1',
    category_id: null,
    description: 'Pago resumen Tarjeta Principal 2026-11',
    occurred_at: '2026-11-05',
    statement_month: '2026-11',
    tags: [],
  });

  const paidItems: PaidStatementItem[] = [
    makePaidItem({
      transaction_id: 'tx_oct_gpu',
      card_account_id: 'acc_card_1',
      card_account_name: 'Tarjeta Principal',
      occurred_at: '2026-10-12',
      description: 'Placa de video cuota 1/3',
      category_id: 'compras',
      tags: ['hw'],
      installment_number: 1,
      installments_total: 3,
      installment_amount: 150000,
      prorated_amount: 150000,
    }),
    makePaidItem({
      transaction_id: 'tx_oct_ssd',
      card_account_id: 'acc_card_1',
      card_account_name: 'Tarjeta Principal',
      occurred_at: '2026-10-20',
      description: 'Disco NVMe 2TB',
      category_id: 'compras',
      tags: ['hw'],
      installment_number: 1,
      installments_total: 1,
      installment_amount: 67643,
      prorated_amount: 67643,
    }),
    makePaidItem({
      transaction_id: 'tx_oct_mochila',
      card_account_id: 'acc_card_2',
      card_account_name: 'Tarjeta Secundaria',
      occurred_at: '2026-10-22',
      description: 'Mochila urbana',
      category_id: 'compras',
      tags: ['personal'],
      installment_number: 1,
      installments_total: 1,
      installment_amount: 2750,
      prorated_amount: 2750,
    }),
    makePaidItem({
      transaction_id: 'tx_oct_streaming',
      card_account_id: 'acc_card_2',
      card_account_name: 'Tarjeta Secundaria',
      occurred_at: '2026-10-25',
      description: 'Suscripción streaming',
      category_id: 'servicios',
      tags: ['fijo'],
      installment_number: 1,
      installments_total: 1,
      installment_amount: 30000,
      prorated_amount: 30000,
    }),
  ];

  it('returns Compras paid_statement_items summing 220393 when transactions only contain statement transfer', () => {
    const opts = makeFilterOptions({ selectedCategory: 'compras' });
    expect(filterTransactions([novPaymentTransfer], opts)).toEqual([]);

    const matchedItems = filterPaidStatementItems(paidItems, opts);
    expect(matchedItems).toHaveLength(3);
    const total = matchedItems.reduce((sum, item) => sum + item.prorated_amount, 0);
    expect(total).toBe(220393);
  });

  it('returns #hw paid_statement_items summing 217643 when filtering by tag hw', () => {
    const opts = makeFilterOptions({ selectedTag: 'hw' });
    expect(filterTransactions([novPaymentTransfer], opts)).toEqual([]);

    const matchedItems = filterPaidStatementItems(paidItems, opts);
    expect(matchedItems).toHaveLength(2);
    const total = matchedItems.reduce((sum, item) => sum + item.prorated_amount, 0);
    expect(total).toBe(217643);
  });

  it('returns empty paid_statement_items when no drill-down filter is active', () => {
    const opts = makeFilterOptions();
    expect(filterPaidStatementItems(paidItems, opts)).toEqual([]);
    expect(filterTransactions([novPaymentTransfer], opts)).toEqual([novPaymentTransfer]);
  });

  it('returns empty paid_statement_items when cardPurchasesOnly or non-expense typeFilter is active', () => {
    expect(
      filterPaidStatementItems(
        paidItems,
        makeFilterOptions({ selectedCategory: 'compras', cardPurchasesOnly: true })
      )
    ).toEqual([]);

    expect(
      filterPaidStatementItems(
        paidItems,
        makeFilterOptions({ selectedCategory: 'compras', typeFilter: 'income' })
      )
    ).toEqual([]);

    expect(
      filterPaidStatementItems(
        paidItems,
        makeFilterOptions({ selectedCategory: 'compras', typeFilter: 'expense' })
      )
    ).toHaveLength(3);
  });

  it('filters paid_statement_items by selectedAccount (card ID) and search query', () => {
    const byCard = filterPaidStatementItems(
      paidItems,
      makeFilterOptions({ selectedAccount: 'acc_card_2' })
    );
    expect(byCard.map((i) => i.transaction_id)).toEqual([
      'tx_oct_mochila',
      'tx_oct_streaming',
    ]);

    const bySearch = filterPaidStatementItems(
      paidItems,
      makeFilterOptions({ search: '  nvme  ' })
    );
    expect(bySearch.map((i) => i.transaction_id)).toEqual(['tx_oct_ssd']);
  });
});

describe('transactionFilters — category "otros" and sorting', () => {
  it('matches "otros" category and uncategorized expenses, excluding income/transfer with null category', () => {
    const expenseExplicitOtros = makeTransaction({
      id: 'tx_otros_explicit',
      type: 'expense',
      category_id: 'otros',
    });
    const expenseNullCat = makeTransaction({
      id: 'tx_expense_null',
      type: 'expense',
      category_id: null,
    });
    const incomeNullCat = makeTransaction({
      id: 'tx_income_null',
      type: 'income',
      category_id: null,
    });
    const transferNullCat = makeTransaction({
      id: 'tx_transfer_null',
      type: 'transfer',
      category_id: null,
      to_account_id: 'acc_card_1',
    });
    const expenseFood = makeTransaction({
      id: 'tx_food',
      type: 'expense',
      category_id: 'comida',
    });

    const filteredTxs = filterTransactions(
      [expenseExplicitOtros, expenseNullCat, incomeNullCat, transferNullCat, expenseFood],
      makeFilterOptions({ selectedCategory: 'otros' })
    );
    expect(filteredTxs.map((t) => t.id)).toEqual(['tx_otros_explicit', 'tx_expense_null']);

    const itemExplicitOtros = makePaidItem({
      transaction_id: 'item_otros',
      category_id: 'otros',
    });
    const itemNullCat = makePaidItem({
      transaction_id: 'item_null',
      category_id: null,
    });
    const itemFood = makePaidItem({
      transaction_id: 'item_food',
      category_id: 'comida',
    });

    const filteredItems = filterPaidStatementItems(
      [itemExplicitOtros, itemNullCat, itemFood],
      makeFilterOptions({ selectedCategory: 'otros' })
    );
    expect(filteredItems.map((i) => i.transaction_id)).toEqual(['item_otros', 'item_null']);
  });

  it('sorts transactions using effectiveTransactionDate (budget_month) and amount', () => {
    const salaryEarlyAssignedNextMonth = makeTransaction({
      id: 'tx_salary',
      type: 'income',
      amount: 100000,
      occurred_at: '2026-10-30',
      budget_month: '2026-11',
      created_at: '2026-10-30T10:00:00Z',
    });
    const midNovExpense = makeTransaction({
      id: 'tx_mid_nov',
      amount: 25000,
      occurred_at: '2026-11-15',
      budget_month: null,
      created_at: '2026-11-15T10:00:00Z',
    });
    const octExpense = makeTransaction({
      id: 'tx_oct',
      amount: 5000,
      occurred_at: '2026-10-29',
      budget_month: null,
      created_at: '2026-10-29T10:00:00Z',
    });

    expect(effectiveTransactionDate(salaryEarlyAssignedNextMonth)).toBe('2026-11-01');
    expect(effectiveTransactionDate(midNovExpense)).toBe('2026-11-15');

    const input = [salaryEarlyAssignedNextMonth, midNovExpense, octExpense];
    expect(sortTransactions(input, 'date_desc').map((t) => t.id)).toEqual([
      'tx_mid_nov',
      'tx_salary',
      'tx_oct',
    ]);
    expect(sortTransactions(input, 'date_asc').map((t) => t.id)).toEqual([
      'tx_oct',
      'tx_salary',
      'tx_mid_nov',
    ]);
    expect(sortTransactions(input, 'amount_desc').map((t) => t.id)).toEqual([
      'tx_salary',
      'tx_mid_nov',
      'tx_oct',
    ]);
    expect(sortTransactions(input, 'amount_asc').map((t) => t.id)).toEqual([
      'tx_oct',
      'tx_mid_nov',
      'tx_salary',
    ]);
  });
});

describe('formatMoney', () => {
  it('formats ARS, USD, and BRL prefixes and Argentine separators', () => {
    expect(formatMoney(1500)).toBe('$ 1.500');
    expect(formatMoney(1500, 'ARS')).toBe('$ 1.500');
    expect(formatMoney(250, 'usd')).toBe('US$ 250');
    expect(formatMoney(420.5, 'BRL')).toBe('R$ 420,50');
  });

  it('handles decimals, negatives, near-zero -0.001, zero, NaN, and Infinity', () => {
    expect(formatMoney(1234.56, 'ARS')).toBe('$ 1.234,56');
    expect(formatMoney(-5000, 'ARS')).toBe('-$ 5.000');
    expect(formatMoney(-12.3, 'USD')).toBe('-US$ 12,30');
    expect(formatMoney(-0.001, 'ARS')).toBe('$ 0');
    expect(formatMoney(-0.001, 'USD')).toBe('US$ 0');
    expect(formatMoney(0, 'BRL')).toBe('R$ 0');
    expect(formatMoney(Number.NaN, 'ARS')).toBe('$ 0');
    expect(formatMoney(Number.POSITIVE_INFINITY, 'USD')).toBe('US$ 0');
    expect(formatMoney(Number.NEGATIVE_INFINITY, 'BRL')).toBe('R$ 0');
  });
});

describe('dashboardViewModel helpers', () => {
  it('builds summary subtitles for zero and multi-currency foreign amounts', () => {
    const emptySummary: Pick<
      MonthSummary,
      'usd_expense' | 'brl_expense' | 'card_purchases_usd' | 'card_purchases_brl'
    > = {
      usd_expense: 0,
      brl_expense: 0,
      card_purchases_usd: 0,
      card_purchases_brl: 0,
    };
    expect(buildSummarySubtitles(emptySummary)).toEqual({
      expenseSubtitle: 'Cuentas líquidas y pagos TC',
      cardPurchasesSubtitle: 'Financiado · no resta liquidez',
    });

    expect(
      buildSummarySubtitles({
        usd_expense: 50,
        brl_expense: 120.5,
        card_purchases_usd: 30,
        card_purchases_brl: 0,
      })
    ).toEqual({
      expenseSubtitle: '+ US$ 50 · + R$ 120,50',
      cardPurchasesSubtitle: '+ US$ 30 · No resta liquidez',
    });

    expect(
      buildSummarySubtitles({
        usd_expense: 0,
        brl_expense: 80,
        card_purchases_usd: 15,
        card_purchases_brl: 45,
      })
    ).toEqual({
      expenseSubtitle: '+ R$ 80',
      cardPurchasesSubtitle: '+ US$ 15 · + R$ 45 · No resta liquidez',
    });
  });

  it('builds current status metrics for ARS-only and multi-currency ARS/USD/BRL accounts', () => {
    const arsOnlyAccounts: AccountWithBalance[] = [
      makeAccount({ id: 'w1', type: 'wallet', currency: 'ARS', balance: 500000 }),
      makeAccount({ id: 's1', type: 'savings', currency: 'ARS', balance: 200000 }),
      makeAccount({ id: 'c1', type: 'credit_card', currency: 'ARS', balance: -150000 }),
    ];

    expect(buildCurrentStatusMetrics(arsOnlyAccounts, 0)).toEqual({
      liquidArs: 700000,
      liquidUsd: 0,
      liquidBrl: 0,
      cardDebtArs: -150000,
      cardDebtUsd: 0,
      cardDebtBrl: 0,
      netWorthArs: 550000,
      netWorthUsd: 0,
      netWorthBrl: 0,
      liquiditySubtitle: 'Cuentas líquidas + Reservas',
      cardDebtSubtitle: 'Saldo acumulado en tarjetas',
      netWorthSubtitle: 'Liquidez menos deuda en TC',
    });

    const multiCurrencyAccounts: AccountWithBalance[] = [
      ...arsOnlyAccounts,
      makeAccount({ id: 'w_usd', type: 'savings', currency: 'USD', balance: 1200 }),
      makeAccount({ id: 'w_brl', type: 'cash', currency: 'BRL', balance: 600 }),
      makeAccount({ id: 'c_usd', type: 'credit_card', currency: 'USD', balance: -200 }),
      makeAccount({ id: 'c_brl', type: 'credit_card', currency: 'BRL', balance: -150 }),
    ];

    expect(buildCurrentStatusMetrics(multiCurrencyAccounts, 45000)).toEqual({
      liquidArs: 700000,
      liquidUsd: 1200,
      liquidBrl: 600,
      cardDebtArs: -150000,
      cardDebtUsd: -200,
      cardDebtBrl: -150,
      netWorthArs: 550000,
      netWorthUsd: 1000,
      netWorthBrl: 450,
      liquiditySubtitle: 'USD: US$ 1.200 · BRL: R$ 600',
      cardDebtSubtitle: 'USD: -US$ 200 · BRL: -R$ 150',
      netWorthSubtitle: 'Por cobrar de terceros: $ 45.000 · USD: US$ 1.000 · BRL: R$ 450',
    });
  });

  it('builds projection title and month meta across ARS, USD, and BRL', () => {
    expect(buildProjectionTitle([makeAccount({ type: 'wallet', name: 'Billetera' })])).toBe(
      'Próximos meses vs. Reservas / Ahorros'
    );
    expect(buildProjectionTitle([makeAccount({ type: 'savings', name: 'Fondo Emergencia' })])).toBe(
      'Próximos meses vs. Fondo Emergencia'
    );
    expect(
      buildProjectionTitle([
        makeAccount({ id: 's1', type: 'savings', name: 'Reserva ARS' }),
        makeAccount({ id: 's2', type: 'savings', name: 'Reserva USD' }),
      ])
    ).toBe('Próximos meses vs. Reservas / Ahorros');

    const baseProjection: Pick<
      MonthProjection,
      | 'installments_total_amount'
      | 'recurring_total_amount'
      | 'recurring_usd_total_amount'
      | 'recurring_brl_total_amount'
    > = {
      installments_total_amount: 120000,
      recurring_total_amount: 85000,
      recurring_usd_total_amount: 0,
      recurring_brl_total_amount: 0,
    };
    expect(buildProjectionMonthMeta(baseProjection)).toBe('Cuotas: $ 120.000 · Fijos: $ 85.000');

    expect(
      buildProjectionMonthMeta({
        installments_total_amount: 120000,
        recurring_total_amount: 85000,
        recurring_usd_total_amount: 25.5,
        recurring_brl_total_amount: 300,
      })
    ).toBe('Cuotas: $ 120.000 · Fijos: $ 85.000 · USD: US$ 25,50 · BRL: R$ 300');
  });
});

describe('defaultCardStatementMonth', () => {
  it('assigns month + 1 before or on closing_day and month + 2 after closing_day', () => {
    expect(defaultCardStatementMonth('2026-11-10', 20)).toBe('2026-12');
    expect(defaultCardStatementMonth('2026-11-20', 20)).toBe('2026-12');
    expect(defaultCardStatementMonth('2026-11-21', 20)).toBe('2027-01');
    expect(defaultCardStatementMonth('2026-12-21', 20)).toBe('2027-02');
  });

  it('clamps closing_day to February and 30-day month lengths', () => {
    expect(defaultCardStatementMonth('2026-02-27', 31)).toBe('2026-03');
    expect(defaultCardStatementMonth('2026-02-28', 31)).toBe('2026-03');
    expect(defaultCardStatementMonth('2028-02-29', 31)).toBe('2028-03');
    expect(defaultCardStatementMonth('2026-04-30', 31)).toBe('2026-05');
    expect(defaultCardStatementMonth('2026-04-30', 29)).toBe('2026-06');
  });

  it('falls back to month + 1 when closing_day is null, undefined, or out of range, and handles invalid dates safely', () => {
    expect(defaultCardStatementMonth('2026-11-25', null)).toBe('2026-12');
    expect(defaultCardStatementMonth('2026-11-25', undefined)).toBe('2026-12');
    expect(defaultCardStatementMonth('2026-12-15', 0)).toBe('2027-01');
    expect(defaultCardStatementMonth('2026-12-15', 32)).toBe('2027-01');
    expect(defaultCardStatementMonth('invalid-date', 20)).toMatch(/^\d{4}-\d{2}$/);
  });
});
