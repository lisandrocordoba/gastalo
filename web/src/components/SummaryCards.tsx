import { ArrowDownRight, ArrowUpRight, Coins, CreditCard, Scale } from 'lucide-react';
import { formatMoney } from '../api';
import type { MonthSummary } from '../types';

interface Props {
  summary: MonthSummary;
  periodLabel: string;
  cardPurchasesFilterActive: boolean;
  onToggleCardPurchasesFilter: () => void;
}

export function SummaryCards({
  summary,
  periodLabel,
  cardPurchasesFilterActive,
  onToggleCardPurchasesFilter,
}: Props) {
  const usdExpense = summary.usd_expense ?? 0;
  const brlExpense = summary.brl_expense ?? 0;
  const foreignExpenseParts = [
    usdExpense > 0 ? `+ ${formatMoney(usdExpense, 'USD')}` : null,
    brlExpense > 0 ? `+ ${formatMoney(brlExpense, 'BRL')}` : null,
  ].filter(Boolean);
  const expenseSubtitle =
    foreignExpenseParts.length > 0
      ? foreignExpenseParts.join(' · ')
      : 'Cuentas líquidas y pagos TC';

  const cardPurchasesUsd = summary.card_purchases_usd ?? 0;
  const cardPurchasesBrl = summary.card_purchases_brl ?? 0;
  const foreignCardParts = [
    cardPurchasesUsd > 0 ? `+ ${formatMoney(cardPurchasesUsd, 'USD')}` : null,
    cardPurchasesBrl > 0 ? `+ ${formatMoney(cardPurchasesBrl, 'BRL')}` : null,
  ].filter(Boolean);
  const cardPurchasesSubtitle =
    foreignCardParts.length > 0
      ? `${foreignCardParts.join(' · ')} · No resta liquidez`
      : 'Financiado · no resta liquidez';

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Resumen del período · <span className="text-zinc-200">{periodLabel}</span>
        </h2>
        <span className="text-[11px] text-zinc-500">
          Flujo real · TC impacta al pagar el resumen
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/75 p-4 transition-colors duration-200 hover:border-zinc-700">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400">Ingresos</span>
            <span className="rounded-lg border border-[#FBC02D]/25 bg-[#FBC02D]/10 p-1.5">
              <ArrowUpRight className="h-4 w-4 text-[#FBC02D]" />
            </span>
          </div>
          <p className="mt-2 text-lg font-bold tracking-tight text-[#FBC02D] tabular-nums sm:text-xl">
            {formatMoney(summary.income)}
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/75 p-4 transition-colors duration-200 hover:border-zinc-700">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400">Gastos consumo</span>
            <span className="rounded-lg border border-[#F44336]/25 bg-[#F44336]/10 p-1.5">
              <ArrowDownRight className="h-4 w-4 text-[#F44336]" />
            </span>
          </div>
          <p className="mt-2 text-lg font-bold tracking-tight text-[#F44336] tabular-nums sm:text-xl">
            {formatMoney(summary.expense)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400 tabular-nums">
            {expenseSubtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={onToggleCardPurchasesFilter}
          title="Clic para filtrar compras hechas con tarjeta de crédito en el período"
          className={`rounded-2xl border p-4 text-left transition-all duration-200 ${
            cardPurchasesFilterActive
              ? 'border-violet-400/70 bg-violet-950/25 ring-1 ring-violet-400/60'
              : 'border-zinc-800 bg-zinc-900/75 hover:border-violet-500/50'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-zinc-400">Compras con TC</span>
              {cardPurchasesFilterActive && (
                <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
                  Filtrando
                </span>
              )}
            </div>
            <span className="rounded-lg border border-violet-500/30 bg-violet-500/15 p-1.5">
              <CreditCard className="h-4 w-4 text-violet-300" />
            </span>
          </div>
          <p className="mt-2 text-lg font-bold tracking-tight text-violet-300 tabular-nums sm:text-xl">
            {formatMoney(summary.card_purchases)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400 tabular-nums">{cardPurchasesSubtitle}</p>
        </button>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/75 p-4 transition-colors duration-200 hover:border-zinc-700">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400">Invertido</span>
            <span className="rounded-lg border border-[#FF4081]/25 bg-[#FF4081]/10 p-1.5">
              <Coins className="h-4 w-4 text-[#FF4081]" />
            </span>
          </div>
          <p className="mt-2 text-lg font-bold tracking-tight text-[#FF4081] tabular-nums sm:text-xl">
            {formatMoney(summary.investment)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400">Excluido de consumo</p>
        </div>

        <div className="col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900/75 p-4 transition-colors duration-200 hover:border-zinc-700 lg:col-span-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-400">Balance del período</span>
            <span className="rounded-lg border border-sky-500/25 bg-sky-500/10 p-1.5">
              <Scale
                className={`h-4 w-4 ${summary.net >= 0 ? 'text-sky-400' : 'text-amber-400'}`}
              />
            </span>
          </div>
          <p
            className={`mt-2 text-lg font-bold tracking-tight tabular-nums sm:text-xl ${
              summary.net >= 0 ? 'text-sky-400' : 'text-amber-400'
            }`}
          >
            {formatMoney(summary.net)}
          </p>
          {summary.investment > 0 && (
            <p className="mt-0.5 text-[11px] text-zinc-400 tabular-nums">
              Post-inv: {formatMoney(summary.net_after_investment)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
