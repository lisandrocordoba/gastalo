import { CalendarClock, Pause, Pencil, Play, Plus, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { formatMoney } from '../api';
import type { AccountWithBalance, FutureProjection, RecurringItem } from '../types';

interface Props {
  projection: FutureProjection;
  recurringItems: RecurringItem[];
  accounts: AccountWithBalance[];
  onAddRecurring: () => void;
  onEditRecurring: (item: RecurringItem) => void;
  onToggleRecurring: (id: string, active: number) => Promise<void>;
  onDeleteRecurring: (id: string) => Promise<void>;
}

export function FutureProjectionCard({
  projection,
  recurringItems,
  accounts,
  onAddRecurring,
  onEditRecurring,
  onToggleRecurring,
  onDeleteRecurring,
}: Props) {
  const accMap = new Map(accounts.map((a) => [a.id, a]));
  const firstMonth = projection.months[0];
  const covered = projection.next_month_coverage_delta >= 0;
  const savingsAccounts = accounts.filter((a) => a.type === 'savings');
  const projectionTitle =
    savingsAccounts.length === 1
      ? `Próximos meses vs. ${savingsAccounts[0].name}`
      : 'Próximos meses vs. Reservas / Ahorros';

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-zinc-200">{projectionTitle}</h3>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            covered
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          }`}
        >
          {covered ? (
            <>
              <ShieldCheck className="h-3.5 w-3.5" />
              {firstMonth?.month} cubierto (+{formatMoney(projection.next_month_coverage_delta)})
            </>
          ) : (
            <>
              <ShieldAlert className="h-3.5 w-3.5" />
              Falta reservar {formatMoney(Math.abs(projection.next_month_coverage_delta))} para{' '}
              {firstMonth?.month}
            </>
          )}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {projection.months.map((m) => (
          <div key={m.month} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
            <p className="text-xs font-semibold text-zinc-300">{m.month}</p>
            <p className="mt-1 text-base font-bold text-zinc-100">
              {formatMoney(m.total_committed)}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Cuotas: {formatMoney(m.installments_total_amount)} · Fijos:{' '}
              {formatMoney(m.recurring_total_amount)}
              {m.recurring_usd_total_amount > 0
                ? ` · USD: ${formatMoney(m.recurring_usd_total_amount, 'USD')}`
                : ''}
            </p>
          </div>
        ))}
      </div>

      {firstMonth && firstMonth.installments.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-400">
            Cuotas activas en {firstMonth.month}
          </p>
          <div className="space-y-1">
            {firstMonth.installments.map((inst) => (
              <div
                key={`${inst.transaction_id}-${inst.installment_number}`}
                className="flex items-center justify-between text-xs text-zinc-300"
              >
                <span className="truncate">
                  {inst.description} ({inst.installment_number}/{inst.installments_total})
                </span>
                <span className="ml-2 shrink-0 font-medium text-zinc-100">
                  {formatMoney(inst.installment_amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-zinc-800 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Gastos fijos mensuales ({recurringItems.filter((r) => r.active === 1).length})
          </span>
          <button
            type="button"
            disabled={accounts.length === 0}
            onClick={onAddRecurring}
            className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar fijo
          </button>
        </div>

        {recurringItems.length > 0 && (
          <div className="mt-2.5 divide-y divide-zinc-800/70">
            {recurringItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-1.5 text-xs">
                <div className={item.active === 1 ? 'text-zinc-200' : 'text-zinc-500 line-through'}>
                  <span className="font-medium">{item.name}</span>
                  {accMap.get(item.account_id) ? (
                    <span className="ml-1.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                      {accMap.get(item.account_id)?.name}
                    </span>
                  ) : null}
                  {item.start_month ? (
                    <span className="ml-1.5 text-zinc-500">· desde {item.start_month}</span>
                  ) : null}
                  {item.day_of_month ? (
                    <span className="ml-1.5 text-zinc-500">· día {item.day_of_month}</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-zinc-100 tabular-nums">
                    {formatMoney(item.amount, item.currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onEditRecurring(item)}
                    title="Editar"
                    className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void onToggleRecurring(item.id, item.active === 1 ? 0 : 1)}
                    title={item.active === 1 ? 'Pausar' : 'Activar'}
                    className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    {item.active === 1 ? (
                      <Pause className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteRecurring(item.id)}
                    title="Eliminar"
                    className="rounded-md p-1 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
