import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  CreditCard,
  X,
} from 'lucide-react';
import { formatMoney } from '../api';
import type { AccountWithBalance, CardStatement, Category } from '../types';

interface Props {
  statementMonth: string;
  onChangeStatementMonth: (nextMonth: string) => void;
  statements: CardStatement[];
  accounts: AccountWithBalance[];
  categories: Category[];
  defaultPayDate: string;
  selectedAccount: string;
  onSelectAccount: (accountId: string) => void;
  onPayStatement: (
    cardId: string,
    payload: {
      statement_month: string;
      from_account_id: string;
      amount: number;
      fees_amount?: number;
      occurred_at: string;
      description?: string;
    }
  ) => Promise<void>;
}

function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function CreditCardsSection({
  statementMonth,
  onChangeStatementMonth,
  statements,
  accounts,
  categories,
  defaultPayDate,
  selectedAccount,
  onSelectAccount,
  onPayStatement,
}: Props) {
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [payingStatement, setPayingStatement] = useState<CardStatement | null>(null);
  const [fromAccountId, setFromAccountId] = useState('mp');
  const [payAmount, setPayAmount] = useState('');
  const [feesAmount, setFeesAmount] = useState('0');
  const [payDate, setPayDate] = useState(defaultPayDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const liquidAccounts = accounts.filter((a) => a.type !== 'credit_card' && a.currency === 'ARS');
  const hasSelectedCard = statements.some((s) => s.account_id === selectedAccount);

  const openPayModal = (st: CardStatement) => {
    setPayingStatement(st);
    setFromAccountId('mp');
    setPayAmount(String(st.total_due > 0 ? st.total_due : Math.abs(st.card_debt)));
    setFeesAmount('0');
    setPayDate(defaultPayDate);
    setError('');
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingStatement) return;
    const amt = Number(payAmount);
    const fees = Number(feesAmount || 0);
    if (!Number.isFinite(amt) || amt < 0 || !Number.isFinite(fees) || fees < 0 || amt + fees <= 0) {
      setError('Ingresá un monto válido mayor a 0.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onPayStatement(payingStatement.account_id, {
        statement_month: payingStatement.statement_month,
        from_account_id: fromAccountId,
        amount: amt,
        fees_amount: fees,
        occurred_at: payDate,
      });
      setPayingStatement(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el pago');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Tarjetas de Crédito (Deuda y Resúmenes)
            </h2>
            {hasSelectedCard && (
              <button
                type="button"
                onClick={() => onSelectAccount('')}
                className="text-xs text-emerald-400 hover:underline"
              >
                Limpiar filtro
              </button>
            )}
          </div>
          <p className="text-[11px] text-zinc-500">
            Tocá una tarjeta para filtrar movimientos · Las compras suman deuda y recién impactan como gasto al pagar el resumen.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-1.5 py-1">
          <span className="px-1.5 text-[11px] text-zinc-400">Resumen:</span>
          <button
            type="button"
            onClick={() => onChangeStatementMonth(shiftYm(statementMonth, -1))}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="px-2 text-xs font-semibold text-zinc-100 tabular-nums">
            {statementMonth}
          </span>
          <button
            type="button"
            onClick={() => onChangeStatementMonth(shiftYm(statementMonth, 1))}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {statements.map((st) => {
          const isExpanded = expandedCardId === st.account_id;
          const isPaid = st.status === 'paid';
          const isSelected = selectedAccount === st.account_id;

          return (
            <div
              key={st.account_id}
              onClick={() => onSelectAccount(isSelected ? '' : st.account_id)}
              className={`flex cursor-pointer flex-col justify-between rounded-2xl border bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-4 shadow-lg transition-all ${
                isSelected
                  ? 'border-emerald-400/70 ring-2 ring-emerald-400/80'
                  : 'border-zinc-700/80 hover:border-zinc-500/80'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-2 text-zinc-200">
                      <CreditCard className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-white">{st.account_name}</p>
                        {isSelected && (
                          <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                            Filtrando
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] uppercase text-zinc-500">{st.currency}</p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                      isPaid
                        ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'
                        : 'border-amber-500/35 bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    {isPaid ? (
                      <>
                        <CheckCircle2 className="h-3 w-3" /> Pagado
                      </>
                    ) : (
                      <>
                        <Clock className="h-3 w-3" /> Pendiente
                      </>
                    )}
                  </span>
                </div>

                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <div>
                    <p className="text-[11px] text-zinc-400">Deuda total acumulada</p>
                    <p
                      className={`text-lg font-bold tracking-tight tabular-nums ${
                        st.card_debt < 0 ? 'text-rose-400' : 'text-zinc-100'
                      }`}
                    >
                      {formatMoney(st.card_debt, st.currency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-zinc-400">Resumen {st.statement_month}</p>
                    <p className="text-base font-semibold text-zinc-100 tabular-nums">
                      {formatMoney(st.total_due, st.currency)}
                    </p>
                  </div>
                </div>

                {st.third_party_total > 0 && (
                  <p className="mt-1 text-[11px] text-sky-300 tabular-nums">
                    Propio: {formatMoney(st.own_total, st.currency)} · Terceros:{' '}
                    {formatMoney(st.third_party_total, st.currency)}
                  </p>
                )}

                {isPaid && st.paid_amount !== null && (
                  <p className="mt-1 text-[11px] text-emerald-400 tabular-nums">
                    Pagado el {st.paid_at}: {formatMoney(st.paid_amount, st.currency)}
                  </p>
                )}
              </div>

              <div className="mt-3 space-y-2 border-t border-zinc-800/90 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedCardId(isExpanded ? null : st.account_id);
                    }}
                    className="inline-flex items-center gap-1 text-xs text-zinc-300 hover:text-white"
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    {st.items.length} {st.items.length === 1 ? 'ítem' : 'ítems'} en resumen
                  </button>

                  {!isPaid && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openPayModal(st);
                      }}
                      className="rounded-xl bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-white"
                    >
                      💳 Pagar resumen
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl bg-zinc-950/90 p-2.5 text-xs"
                  >
                    {st.items.length === 0 ? (
                      <p className="text-zinc-500">Sin cuotas registradas para este mes.</p>
                    ) : (
                      st.items.map((item) => {
                        const cat = item.category_id ? catMap.get(item.category_id) : null;
                        return (
                          <div
                            key={`${item.transaction_id}-${item.installment_number}`}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="truncate text-zinc-300">
                              {item.type === 'third_party' ? '🤝' : (cat?.icon ?? '📦')}{' '}
                              {item.description}
                              {item.installments_total > 1
                                ? ` (${item.installment_number}/${item.installments_total})`
                                : ''}
                            </span>
                            <span className="shrink-0 font-medium text-zinc-100 tabular-nums">
                              {formatMoney(item.installment_amount, st.currency)}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {payingStatement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                Pagar resumen {payingStatement.account_name} ({payingStatement.statement_month})
              </h3>
              <button
                type="button"
                onClick={() => setPayingStatement(null)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handlePaySubmit} className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Cuenta que paga</label>
                <select
                  value={fromAccountId}
                  onChange={(e) => setFromAccountId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                >
                  {liquidAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatMoney(a.balance, a.currency)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Consumos y cuotas</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Sellos / Impuestos (opc.)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={feesAmount}
                    onChange={(e) => setFeesAmount(e.target.value)}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-zinc-400">Fecha real de pago</label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300 tabular-nums">
                Total a debitar de cuenta:{' '}
                <strong className="text-white">
                  {formatMoney(
                    (Number(payAmount) || 0) + (Number(feesAmount) || 0),
                    payingStatement.currency
                  )}
                </strong>
              </div>

              {error && <p className="text-xs text-rose-400">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPayingStatement(null)}
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saving ? 'Registrando...' : 'Confirmar pago'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
