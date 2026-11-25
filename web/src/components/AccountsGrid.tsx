import { useState } from 'react';
import { Banknote, Check, CreditCard, Pencil, ShieldCheck, Smartphone, X } from 'lucide-react';
import { formatMoney } from '../api';
import type { AccountWithBalance } from '../types';

interface Props {
  accounts: AccountWithBalance[];
  onSaveInitialBalance: (accountId: string, initialBalance: number) => Promise<void>;
}

const iconForType = {
  wallet: Smartphone,
  savings: ShieldCheck,
  credit_card: CreditCard,
  cash: Banknote,
};

export function AccountsGrid({ accounts, onSaveInitialBalance }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftInitial, setDraftInitial] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (acc: AccountWithBalance) => {
    setEditingId(acc.id);
    setDraftInitial(String(acc.initial_balance));
  };

  const submitEdit = async (accId: string) => {
    const num = Number(draftInitial);
    if (!Number.isFinite(num)) return;
    setSaving(true);
    try {
      await onSaveInitialBalance(accId, num);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Cuentas y Saldos
        </h2>
        <span className="text-xs text-zinc-500">Tocá el lápiz para ajustar saldo inicial</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {accounts.map((acc) => {
          const Icon = iconForType[acc.type] ?? Smartphone;
          const isNegative = acc.balance < 0;
          const isEditing = editingId === acc.id;

          return (
            <div
              key={acc.id}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-zinc-700"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-zinc-800 p-2 text-zinc-300">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-100">{acc.name}</p>
                    <p className="text-[11px] uppercase text-zinc-500">{acc.currency}</p>
                  </div>
                </div>
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => startEdit(acc)}
                    title="Editar saldo inicial"
                    className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <p
                className={`mt-3 text-xl font-bold tracking-tight ${
                  isNegative ? 'text-rose-400' : 'text-zinc-50'
                }`}
              >
                {formatMoney(acc.balance, acc.currency)}
              </p>

              {isEditing ? (
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.01"
                    value={draftInitial}
                    onChange={(e) => setDraftInitial(e.target.value)}
                    placeholder="Saldo inicial"
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
                    onClick={() => setEditingId(null)}
                    className="rounded-lg bg-zinc-800 p-1.5 text-zinc-300 hover:bg-zinc-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-zinc-500">
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
