import { CreditCard, Landmark, Wallet } from 'lucide-react';
import { formatMoney } from '../api';
import type { AccountWithBalance } from '../types';
import { buildCurrentStatusMetrics } from '../utils/dashboardViewModel';

interface Props {
  accounts: AccountWithBalance[];
  thirdPartyPending: number;
}

export function CurrentStatusBar({ accounts, thirdPartyPending }: Props) {
  const {
    liquidArs,
    cardDebtArs,
    netWorthArs,
    liquiditySubtitle,
    cardDebtSubtitle,
    netWorthSubtitle,
  } = buildCurrentStatusMetrics(accounts, thirdPartyPending);

  const cards = [
    {
      label: 'Liquidez disponible ARS',
      value: formatMoney(liquidArs),
      subtitle: liquiditySubtitle,
      icon: Landmark,
      color: liquidArs >= 0 ? 'text-[#38BDF8]' : 'text-rose-400',
      bg: 'bg-[#009EE3]/10 border-[#009EE3]/30',
    },
    {
      label: 'Deuda total en TC ARS',
      value: formatMoney(cardDebtArs),
      subtitle: cardDebtSubtitle,
      icon: CreditCard,
      color: cardDebtArs < 0 ? 'text-rose-400' : 'text-zinc-100',
      bg: 'bg-zinc-800/80 border-zinc-700',
    },
    {
      label: 'Patrimonio neto ARS',
      value: formatMoney(netWorthArs),
      subtitle: netWorthSubtitle,
      icon: Wallet,
      color: netWorthArs >= 0 ? 'text-emerald-400' : 'text-rose-400',
      bg: 'bg-emerald-500/10 border-emerald-500/25',
    },
  ];

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Estado actual hoy
        </h2>
        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-[11px] text-zinc-400">
          Fijo · independiente de las fechas
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.label}
              className="rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-3.5 transition-colors duration-200 hover:border-zinc-700"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-400">{c.label}</span>
                <span className={`rounded-lg border p-1.5 ${c.bg}`}>
                  <Icon className={`h-3.5 w-3.5 ${c.color}`} />
                </span>
              </div>
              <p className={`mt-1.5 text-lg font-bold tracking-tight tabular-nums ${c.color}`}>
                {c.value}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-400 tabular-nums">{c.subtitle}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
