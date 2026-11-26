import { useState } from 'react';
import { Banknote, Check, Pencil, Plus, Scale, ShieldCheck, Smartphone, X } from 'lucide-react';
import { formatMoney } from '../api';
import type { AccountWithBalance } from '../types';

interface Props {
  accounts: AccountWithBalance[];
  selectedAccount: string;
  onSelectAccount: (accountId: string) => void;
  onCreateAccount: () => void;
  onEditAccount: (acc: AccountWithBalance) => void;
  onReconcileBalance: (accountId: string, realBalance: number) => Promise<void>;
}

const iconForType = {
  wallet: Smartphone,
  savings: ShieldCheck,
  cash: Banknote,
};

export function AccountsGrid({
  accounts,
  selectedAccount,
  onSelectAccount,
  onCreateAccount,
  onEditAccount,
  onReconcileBalance,
}: Props) {
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [saving, setSaving] = useState(false);

  const liquidAccounts = accounts.filter((a) => a.type !== 'credit_card');
  const hasSelectedLiquid = liquidAccounts.some((a) => a.id === selectedAccount);

  const startReconcile = (acc: AccountWithBalance) => {
    setReconcileId(acc.id);
    setDraftValue(String(acc.balance));
  };

  const cancelReconcile = () => {
    setReconcileId(null);
  };

  const submitReconcile = async (accId: string) => {
    const num = Number(draftValue);
    if (!Number.isFinite(num)) return;
    setSaving(true);
    try {
      await onReconcileBalance(accId, num);
      cancelReconcile();
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
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-zinc-500 sm:inline">
            Tocá una cuenta para filtrar · ⚖️ Conciliar · ✏️ Editar
          </span>
          <button
            type="button"
            onClick={onCreateAccount}
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:border-emerald-500/50 hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5 text-emerald-400" />
            Nueva cuenta
          </button>
        </div>
      </div>

      {liquidAccounts.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-xs text-zinc-400">
            Todavía no agregaste cuentas líquidas (banco, billetera, reservas o efectivo).
          </p>
          <button
            type="button"
            onClick={onCreateAccount}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Crear cuenta
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {liquidAccounts.map((acc) => {
            const Icon = iconForType[acc.type as keyof typeof iconForType] ?? Smartphone;
            const accent = acc.color || '#009EE3';
            const isNegative = acc.balance < 0;
            const isReconciling = reconcileId === acc.id;
            const isSelected = selectedAccount === acc.id;

            return (
              <div
                key={acc.id}
                onClick={() => {
                  if (!isReconciling) {
                    onSelectAccount(isSelected ? '' : acc.id);
                  }
                }}
                style={{
                  borderColor: isSelected ? undefined : `${accent}55`,
                  backgroundImage: `linear-gradient(135deg, ${accent}20 0%, rgba(24,24,27,0.92) 55%, #09090b 100%)`,
                }}
                className={`rounded-2xl border p-4 transition-all duration-200 ${
                  isReconciling ? '' : 'cursor-pointer'
                } ${isSelected ? 'border-emerald-400/70 ring-2 ring-emerald-400/80' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="rounded-xl border p-2"
                      style={{
                        borderColor: `${accent}66`,
                        backgroundColor: `${accent}24`,
                        color: '#f4f4f5',
                      }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: accent }}
                        />
                        <p className="text-sm font-semibold text-zinc-100">
                          {acc.name}
                          {acc.is_default ? ' ⭐' : ''}
                        </p>
                        {isSelected && (
                          <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                            Filtrando
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] uppercase text-zinc-400">{acc.currency}</p>
                    </div>
                  </div>
                  {!isReconciling && (
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => startReconcile(acc)}
                        title="Conciliar saldo real"
                        className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-emerald-400"
                      >
                        <Scale className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditAccount(acc)}
                        title="Editar cuenta"
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

                {isReconciling ? (
                  <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
                    <span className="block text-[11px] text-zinc-300">Saldo real actual:</span>
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
                        onClick={() => void submitReconcile(acc.id)}
                        className="rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={cancelReconcile}
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
      )}
    </section>
  );
}
