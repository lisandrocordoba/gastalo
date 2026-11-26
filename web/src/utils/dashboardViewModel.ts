import type { AccountWithBalance, MonthProjection, MonthSummary } from '../types';
import { formatMoney } from './format';

export interface SummarySubtitles {
  expenseSubtitle: string;
  cardPurchasesSubtitle: string;
}

export interface CurrentStatusMetrics {
  liquidArs: number;
  liquidUsd: number;
  liquidBrl: number;
  cardDebtArs: number;
  cardDebtUsd: number;
  cardDebtBrl: number;
  netWorthArs: number;
  netWorthUsd: number;
  netWorthBrl: number;
  liquiditySubtitle: string;
  cardDebtSubtitle: string;
  netWorthSubtitle: string;
}

function formatForeignPlusParts(usdAmount: number, brlAmount: number): string[] {
  const parts: string[] = [];
  if (usdAmount > 0) parts.push(`+ ${formatMoney(usdAmount, 'USD')}`);
  if (brlAmount > 0) parts.push(`+ ${formatMoney(brlAmount, 'BRL')}`);
  return parts;
}

function sumBalanceByCurrency(
  accounts: Pick<AccountWithBalance, 'type' | 'currency' | 'balance'>[],
  isCard: boolean,
  currency: 'ARS' | 'USD' | 'BRL'
): number {
  return accounts
    .filter(
      (a) => (isCard ? a.type === 'credit_card' : a.type !== 'credit_card') && a.currency === currency
    )
    .reduce((sum, a) => sum + a.balance, 0);
}

function formatForeignBalanceParts(usdAmount: number, brlAmount: number): string[] {
  const parts: string[] = [];
  if (usdAmount !== 0) parts.push(`USD: ${formatMoney(usdAmount, 'USD')}`);
  if (brlAmount !== 0) parts.push(`BRL: ${formatMoney(brlAmount, 'BRL')}`);
  return parts;
}

/**
 * Builds secondary currency subtitles for the summary KPI cards.
 */
export function buildSummarySubtitles(
  summary: Pick<
    MonthSummary,
    'usd_expense' | 'brl_expense' | 'card_purchases_usd' | 'card_purchases_brl'
  >
): SummarySubtitles {
  const foreignExpenseParts = formatForeignPlusParts(
    summary.usd_expense ?? 0,
    summary.brl_expense ?? 0
  );
  const expenseSubtitle =
    foreignExpenseParts.length > 0
      ? foreignExpenseParts.join(' · ')
      : 'Cuentas líquidas y pagos TC';

  const foreignCardParts = formatForeignPlusParts(
    summary.card_purchases_usd ?? 0,
    summary.card_purchases_brl ?? 0
  );
  const cardPurchasesSubtitle =
    foreignCardParts.length > 0
      ? `${foreignCardParts.join(' · ')} · No resta liquidez`
      : 'Financiado · no resta liquidez';

  return { expenseSubtitle, cardPurchasesSubtitle };
}

/**
 * Aggregates liquid, credit card, and net worth totals per currency and builds status subtitles.
 */
export function buildCurrentStatusMetrics(
  accounts: Pick<AccountWithBalance, 'type' | 'currency' | 'balance'>[],
  thirdPartyPending: number
): CurrentStatusMetrics {
  const liquidArs = sumBalanceByCurrency(accounts, false, 'ARS');
  const liquidUsd = sumBalanceByCurrency(accounts, false, 'USD');
  const liquidBrl = sumBalanceByCurrency(accounts, false, 'BRL');

  const cardDebtArs = sumBalanceByCurrency(accounts, true, 'ARS');
  const cardDebtUsd = sumBalanceByCurrency(accounts, true, 'USD');
  const cardDebtBrl = sumBalanceByCurrency(accounts, true, 'BRL');

  const netWorthArs = liquidArs + cardDebtArs;
  const netWorthUsd = liquidUsd + cardDebtUsd;
  const netWorthBrl = liquidBrl + cardDebtBrl;

  const liquidForeignParts = formatForeignBalanceParts(liquidUsd, liquidBrl);
  const cardDebtForeignParts = formatForeignBalanceParts(cardDebtUsd, cardDebtBrl);
  const netWorthSubtitleParts = [
    thirdPartyPending > 0 ? `Por cobrar de terceros: ${formatMoney(thirdPartyPending)}` : null,
    ...formatForeignBalanceParts(netWorthUsd, netWorthBrl),
  ].filter((part): part is string => part !== null);

  return {
    liquidArs,
    liquidUsd,
    liquidBrl,
    cardDebtArs,
    cardDebtUsd,
    cardDebtBrl,
    netWorthArs,
    netWorthUsd,
    netWorthBrl,
    liquiditySubtitle:
      liquidForeignParts.length > 0
        ? liquidForeignParts.join(' · ')
        : 'Cuentas líquidas + Reservas',
    cardDebtSubtitle:
      cardDebtForeignParts.length > 0
        ? cardDebtForeignParts.join(' · ')
        : 'Saldo acumulado en tarjetas',
    netWorthSubtitle:
      netWorthSubtitleParts.length > 0
        ? netWorthSubtitleParts.join(' · ')
        : 'Liquidez menos deuda en TC',
  };
}

/**
 * Resolves the heading title for the future projection card based on savings accounts.
 */
export function buildProjectionTitle(accounts: Pick<AccountWithBalance, 'type' | 'name'>[]): string {
  const savingsAccounts = accounts.filter((a) => a.type === 'savings');
  return savingsAccounts.length === 1
    ? `Próximos meses vs. ${savingsAccounts[0].name}`
    : 'Próximos meses vs. Reservas / Ahorros';
}

/**
 * Formats the breakdown subtitle for a single projected month (installments + recurring items).
 */
export function buildProjectionMonthMeta(
  m: Pick<
    MonthProjection,
    | 'installments_total_amount'
    | 'recurring_total_amount'
    | 'recurring_usd_total_amount'
    | 'recurring_brl_total_amount'
  >
): string {
  const parts = [
    `Cuotas: ${formatMoney(m.installments_total_amount)}`,
    `Fijos: ${formatMoney(m.recurring_total_amount)}`,
  ];
  if (m.recurring_usd_total_amount > 0) {
    parts.push(`USD: ${formatMoney(m.recurring_usd_total_amount, 'USD')}`);
  }
  const brl = m.recurring_brl_total_amount ?? 0;
  if (brl > 0) {
    parts.push(`BRL: ${formatMoney(brl, 'BRL')}`);
  }
  return parts.join(' · ');
}
