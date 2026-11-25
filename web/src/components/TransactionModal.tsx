import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { AccountWithBalance, Category, Transaction, TransactionType } from '../types';

interface Props {
  open: boolean;
  editing: Transaction | null;
  accounts: AccountWithBalance[];
  categories: Category[];
  defaultDate: string;
  onClose: () => void;
  onSubmit: (payload: {
    id?: string;
    type: TransactionType;
    amount: number;
    currency: string;
    account_id: string;
    to_account_id: string | null;
    category_id: string | null;
    description: string;
    occurred_at: string;
  }) => Promise<void>;
}

export function TransactionModal({
  open,
  editing,
  accounts,
  categories,
  defaultDate,
  onClose,
  onSubmit,
}: Props) {
  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('ARS');
  const [accountId, setAccountId] = useState('mp');
  const [toAccountId, setToAccountId] = useState('mp_reservas');
  const [categoryId, setCategoryId] = useState('comida');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState(defaultDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setType(editing.type);
      setAmount(String(editing.amount));
      setCurrency(editing.currency);
      setAccountId(editing.account_id);
      setToAccountId(editing.to_account_id || 'mp_reservas');
      setCategoryId(editing.category_id || (editing.type === 'income' ? 'sueldo' : 'otros'));
      setDescription(editing.description);
      setOccurredAt(editing.occurred_at);
    } else {
      setType('expense');
      setAmount('');
      setCurrency('ARS');
      setAccountId(accounts.find((a) => a.is_default)?.id ?? accounts[0]?.id ?? 'mp');
      setToAccountId('mp_reservas');
      setCategoryId('comida');
      setDescription('');
      setOccurredAt(defaultDate);
    }
  }, [open, editing, accounts, defaultDate]);

  if (!open) return null;

  const filteredCategories = categories.filter((c) =>
    type === 'income' ? c.type === 'income' || c.type === 'both' : c.type === 'expense' || c.type === 'both'
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setError('Ingresá un monto válido mayor a 0.');
      return;
    }
    if (!description.trim()) {
      setError('Ingresá una descripción.');
      return;
    }
    if (type === 'transfer' && accountId === toAccountId) {
      setError('La cuenta origen y destino deben ser distintas.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSubmit({
        id: editing?.id,
        type,
        amount: numAmount,
        currency,
        account_id: accountId,
        to_account_id: type === 'transfer' ? toAccountId : null,
        category_id: type === 'transfer' ? null : categoryId,
        description: description.trim(),
        occurred_at: occurredAt,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-100">
            {editing ? 'Editar movimiento' : 'Nuevo movimiento'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-zinc-950 p-1">
            {(['expense', 'income', 'transfer'] as TransactionType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setType(t);
                  if (t === 'income') setCategoryId('sueldo');
                  if (t === 'expense') setCategoryId('comida');
                }}
                className={`rounded-lg py-1.5 text-xs font-medium transition ${
                  type === t
                    ? 'bg-zinc-800 text-white shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t === 'expense' ? 'Gasto' : t === 'income' ? 'Ingreso' : 'Transferencia'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-zinc-400">Monto</label>
              <input
                type="number"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="12500"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Moneda</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              >
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-400">Descripción</label>
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Supermercado Coto"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                {type === 'transfer' ? 'Cuenta origen' : 'Cuenta'}
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            {type === 'transfer' ? (
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Cuenta destino</label>
                <select
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Categoría</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                >
                  {filteredCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-400">Fecha</label>
            <input
              type="date"
              required
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
