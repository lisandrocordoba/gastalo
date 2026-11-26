import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { AccountWithBalance, Category, RecurringItem } from '../types';

export interface RecurringPayload {
  name: string;
  amount: number;
  currency: string;
  account_id: string;
  category_id: string | null;
  day_of_month: number | null;
  start_month: string | null;
  active: number;
}

interface Props {
  open: boolean;
  editing: RecurringItem | null;
  defaultAccountId?: string;
  defaultStartMonth: string;
  accounts: AccountWithBalance[];
  categories: Category[];
  onClose: () => void;
  onCreate: (payload: RecurringPayload) => Promise<void>;
  onUpdate: (id: string, patch: Partial<RecurringPayload>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function RecurringModal({
  open,
  editing,
  defaultAccountId,
  defaultStartMonth,
  accounts,
  categories,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const expenseCategories = categories.filter((c) => c.type === 'expense' || c.type === 'both');
  const fallbackAccountId =
    accounts.find((a) => a.is_default === 1 && a.type !== 'credit_card')?.id ??
    accounts[0]?.id ??
    '';
  const fallbackCategoryId =
    expenseCategories.find((c) => c.id === 'suscripciones')?.id ??
    expenseCategories[0]?.id ??
    '';

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(fallbackAccountId);
  const [categoryId, setCategoryId] = useState(fallbackCategoryId);
  const [startMonth, setStartMonth] = useState(defaultStartMonth);
  const [dayOfMonth, setDayOfMonth] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const prevOpenRef = useRef(false);
  const prevEditingIdRef = useRef<string | null>(null);

  useEffect(() => {
    const currentEditingId = editing?.id ?? null;
    const justOpened = open && !prevOpenRef.current;
    const editingChangedWhileOpen =
      open && prevOpenRef.current && currentEditingId !== prevEditingIdRef.current;
    prevOpenRef.current = open;
    prevEditingIdRef.current = currentEditingId;

    if (!open || (!justOpened && !editingChangedWhileOpen)) return;

    setError('');
    if (editing) {
      setName(editing.name);
      setAmount(String(editing.amount));
      setAccountId(editing.account_id || fallbackAccountId);
      setCategoryId(editing.category_id ?? fallbackCategoryId);
      setStartMonth(editing.start_month ?? '');
      setDayOfMonth(editing.day_of_month ? String(editing.day_of_month) : '');
      setActive(editing.active === 1);
    } else {
      const targetAccId =
        defaultAccountId && accounts.some((a) => a.id === defaultAccountId)
          ? defaultAccountId
          : fallbackAccountId;
      setName('');
      setAmount('');
      setAccountId(targetAccId);
      setCategoryId(fallbackCategoryId);
      setStartMonth(defaultStartMonth);
      setDayOfMonth('');
      setActive(true);
    }
  }, [open, editing, defaultAccountId, defaultStartMonth, accounts, fallbackAccountId, fallbackCategoryId]);

  if (!open) return null;

  const chosenAcc = accounts.find((a) => a.id === accountId);
  const chosenCurrency = chosenAcc?.currency ?? editing?.currency ?? 'ARS';
  const isCreditCard = chosenAcc?.type === 'credit_card';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    const numAmount = Number(amount);
    if (!cleanName) {
      setError('Ingresá un nombre para el gasto fijo o suscripción.');
      return;
    }
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setError('Ingresá un monto válido mayor a 0.');
      return;
    }
    if (!accountId) {
      setError('Seleccioná una cuenta o tarjeta.');
      return;
    }

    let parsedDay: number | null = null;
    if (dayOfMonth.trim() !== '') {
      const dayNum = Number(dayOfMonth);
      if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
        setError('El día del mes debe ser un número entre 1 y 31.');
        return;
      }
      parsedDay = dayNum;
    }

    const cleanStartMonth = /^\d{4}-\d{2}$/.test(startMonth.trim()) ? startMonth.trim() : null;

    setSaving(true);
    setError('');
    try {
      const payload: RecurringPayload = {
        name: cleanName,
        amount: numAmount,
        currency: chosenCurrency,
        account_id: accountId,
        category_id: categoryId || null,
        day_of_month: parsedDay,
        start_month: cleanStartMonth,
        active: active ? 1 : 0,
      };
      if (editing) {
        await onUpdate(editing.id, payload);
      } else {
        await onCreate(payload);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el gasto fijo');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!window.confirm(`¿Eliminar "${editing.name}"? Los pagos ya registrados no se borran.`)) {
      return;
    }
    setDeleting(true);
    setError('');
    try {
      await onDelete(editing.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el gasto fijo');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-xs">
      <div className="my-auto w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">
            {editing ? `Editar: ${editing.name}` : 'Nuevo gasto fijo / suscripción'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Nombre</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Google AI Pro / Internet / Gimnasio"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Cuenta o tarjeta</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 outline-none focus:border-emerald-500"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-zinc-400">Monto ({chosenCurrency})</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 tabular-nums outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-400">Categoría</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 outline-none focus:border-emerald-500"
            >
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                {isCreditCard ? 'Primer resumen' : 'Desde mes'}
              </label>
              <input
                type="month"
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                {isCreditCard ? 'Día aprox. de cobro (opc.)' : 'Día de vencimiento (opc.)'}
              </label>
              <input
                type="number"
                min="1"
                max="31"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
                placeholder="Opcional"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {isCreditCard && (
            <p className="rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-200/90">
              En tarjetas, el mes de resumen manda: la suscripción aparecerá para confirmar con 1 clic desde ese resumen. El día es solo referencia para fechar el cargo.
            </p>
          )}

          {editing && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-950 accent-emerald-500"
              />
              Activo (incluir en proyecciones y resúmenes futuros)
            </label>
          )}

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex items-center justify-between gap-2 pt-2">
            {editing ? (
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  disabled={saving || deleting}
                  onClick={handleDelete}
                  className="inline-flex w-fit items-center gap-1 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Eliminar
                </button>
                <span className="text-[10px] text-zinc-500">
                  Eliminar no borra cargos ya registrados
                </span>
              </div>
            ) : (
              <span />
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || deleting || accounts.length === 0}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
