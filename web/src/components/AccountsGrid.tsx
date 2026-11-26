import { useState } from 'react';
import { Banknote, Check, Pencil, Scale, ShieldCheck, Smartphone, X } from 'lucide-react';
import { formatMoney } from '../api';
import type { AccountWithBalance } from '../types';

interface Props {
  accounts: AccountWithBalance[];
  selectedAccount: string;
  onSelectAccount: (accountId: string) => void;
  onSaveInitialBalance: (accountId: string, initialBalance: number) => Promise<void>;
  onReconcileBalance: (accountId: string, realBalance: number) => Promise<void>;
}

const iconForType = {
  wallet: Smartphone,
  savings: ShieldCheck,
  cash: Banknote,
};

function accountTheme(acc: AccountWithBalance): {
  card: string;
  badge: string;
  dot: string;
} {
  if (acc.type === 'cash') {
    return {
      card: 'border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 via-zinc-900/90 to-zinc-950 hover:border-emerald-400/50',
      badge: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
      dot: 'bg-emerald-400',
    };
  }
  if (acc.id === 'mp_reservas' || acc.type === 'savings') {
    return {
      card: 'border-sky-500/30 bg-gradient-to-br from-sky-950/40 via-zinc-900/90 to-zinc-950 hover:border-sky-400/50',
      badge: 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
      dot: 'bg-sky-400',
    };
  }
  return {
    card: 'border-[#009EE3]/35 bg-gradient-to-br from-[#009EE3]/15 via-zinc-900/90 to-zinc-950 hover:border-[#009EE3]/60',
    badge: 'bg-[#009EE3]/20 text-[#38BDF8] border border-[#009EE3]/35',
    dot: 'bg-[#009EE3]',
  };
}

export function AccountsGrid({
  accounts,
  selectedAccount,
  onSelectAccount,
  onSaveInitialBalance,
  onReconcileBalance,
}: Props) {
  const [mode, setMode] = useState<'initial' | 'reconcile' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [saving, setSaving] = useState(false);

  const liquidAccounts = accounts.filter((a) => a.type !== 'credit_card');
  const hasSelectedLiquid = liquidAccounts.some((a) => a.id === selectedAccount);

  const startEdit = (acc: AccountWithBalance, nextMode: 'initial' | 'reconcile') => {
    setEditingId(acc.id);
    setMode(nextMode);
    setDraftValue(String(nextMode === 'initial' ? acc.initial_balance : acc.balance));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setMode(null);
  };

  const submitEdit = async (accId: string) => {
    const num = Number(draftValue);
    if (!Number.isFinite(num)) return;
    setSaving(true);
    try {
      if (mode === 'reconcile') {
        await onReconcileBalance(accId, num);
      } else {
        await onSaveInitialBalance(accId, num);
      }
      cancelEdit();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Cuentas de Dinero (Liquidez)
          </h2>
          {hasSelectedLiquid && (
            <button
              type="button"
              onClick={() => onSelectAccount('')}
              className="text-xs text-emerald-400 hover:underline"
            >
              Limpiar filtro
            </button>
          )}
        </div>
        <span className="text-xs text-zinc-500">
          Tocá una cuenta para filtrar · ⚖️ Conciliar · ✏️ Saldo inicial
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {liquidAccounts.map((acc) => {
          const Icon = iconForType[acc.type as keyof typeof iconForType] ?? Smartphone;
          const theme = accountTheme(acc);
          const isNegative = acc.balance < 0;
          const isEditing = editingId === acc.id;
          const isSelected = selectedAccount === acc.id;

          return (
            <div
              key={acc.id}
              onClick={() => {
                if (!isEditing) {
                  onSelectAccount(isSelected ? '' : acc.id);
                }
              }}
              className={`rounded-2xl border p-4 transition-all duration-200 ${theme.card} ${
                isEditing ? '' : 'cursor-pointer'
              } ${isSelected ? 'border-emerald-400/70 ring-2 ring-emerald-400/80' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`rounded-xl p-2 ${theme.badge}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${theme.dot}`} />
                      <p className="text-sm font-semibold text-zinc-100">{acc.name}</p>
                      {isSelected && (
                        <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                          Filtrando
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] uppercase text-zinc-400">{acc.currency}</p>
                  </div>
                </div>
                {!isEditing && (
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => startEdit(acc, 'reconcile')}
                      title="Conciliar saldo real"
                      className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-emerald-400"
                    >
                      <Scale className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(acc, 'initial')}
                      title="Editar saldo inicial"
                      className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <p
                className={`mt-3 text-xl font-bold tracking-tight tabular-nums ${
                  isNegative ? 'text-rose-400' : 'text-white'
                }`}
              >
                {formatMoney(acc.balance, acc.currency)}
              </p>

              {isEditing ? (
                <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
                  <span className="block text-[11px] text-zinc-300">
                    {mode === 'reconcile' ? 'Saldo real actual:' : 'Saldo inicial:'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="0.01"
                      value={draftValue}
                      onChange={(e) => setDraftValue(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => submitEdit(acc.id)}
                      className="rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded-lg bg-zinc-800 p-1.5 text-zinc-300 hover:bg-zinc-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-zinc-400 tabular-nums">
                  Saldo inicial: {formatMoney(acc.initial_balance, acc.currency)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
