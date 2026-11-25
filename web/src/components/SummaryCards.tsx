import { ArrowDownRight, ArrowUpRight, Scale, Wallet } from 'lucide-react';
import { formatMoney } from '../api';
import type { MonthSummary } from '../types';

interface Props {
  summary: MonthSummary;
}

export function SummaryCards({ summary }: Props) {
  const netWorth = summary.accounts.reduce((acc, a) => acc + a.balance, 0);

  const cards = [
    {
      label: 'Ingresos del mes',
      value: formatMoney(summary.income),
      icon: ArrowUpRight,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10 border-emerald-500/20',
    },
    {
      label: 'Gastos del mes',
      value: formatMoney(summary.expense),
      icon: ArrowDownRight,
      color: 'text-rose-400',
      bg: 'bg-rose-500/10 border-rose-500/20',
    },
    {
      label: 'Balance mensual',
      value: formatMoney(summary.net),
      icon: Scale,
      color: summary.net >= 0 ? 'text-sky-400' : 'text-amber-400',
      bg: 'bg-sky-500/10 border-sky-500/20',
    },
    {
      label: 'Patrimonio neto',
      value: formatMoney(netWorth),
      icon: Wallet,
      color: netWorth >= 0 ? 'text-violet-400' : 'text-rose-400',
      bg: 'bg-violet-500/10 border-violet-500/20',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.label}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 backdrop-blur-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-400">{c.label}</span>
              <span className={`rounded-lg border p-1.5 ${c.bg}`}>
                <Icon className={`h-4 w-4 ${c.color}`} />
              </span>
            </div>
            <p className={`mt-2 text-lg font-semibold tracking-tight sm:text-xl ${c.color}`}>
              {c.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}
