import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { SUPPORTED_CURRENCIES, type AccountType, type AccountWithBalance, type SupportedCurrency } from '../types';

interface Props {
  open: boolean;
  editing: AccountWithBalance | null;
  defaultType?: AccountType;
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    type: AccountType;
    currency: string;
    initial_balance: number;
    color: string;
    is_default: number;
    due_day: number | null;
  }) => Promise<void>;
  onUpdate: (
    id: string,
    patch: {
      name: string;
      type: AccountType;
      currency: string;
      initial_balance: number;
      color: string;
      is_default: number;
      due_day: number | null;
    }
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const ACCOUNT_TYPES: { id: AccountType; label: string }[] = [
  { id: 'wallet', label: 'Billetera / Banco' },
  { id: 'savings', label: 'Reservas / Ahorro' },
  { id: 'cash', label: 'Efectivo' },
  { id: 'credit_card', label: 'Tarjeta de crédito' },
];

const CURRENCY_LABELS: Record<SupportedCurrency, string> = {
  ARS: 'ARS ($)',
  USD: 'USD (US$)',
  BRL: 'BRL (R$)',
};

function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

const COLOR_SWATCHES = [
  '#009EE3',
  '#22C55E',
  '#0EA5E9',
  '#8B5CF6',
  '#F97316',
  '#EC4899',
  '#EAB308',
  '#18181B',
];

function defaultColorForType(t: AccountType): string {
  switch (t) {
    case 'cash':
      return '#22C55E';
    case 'savings':
      return '#0EA5E9';
    case 'credit_card':
      return '#18181B';
    default:
      return '#009EE3';
  }
}

export function AccountModal({
  open,
  editing,
  defaultType = 'wallet',
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>(defaultType);
  const [currency, setCurrency] = useState('ARS');
  const [initialBalance, setInitialBalance] = useState('0');
  const [color, setColor] = useState(() => defaultColorForType(defaultType));
  const [colorTouched, setColorTouched] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [dueDay, setDueDay] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      const normalizedCurrency = editing.currency.trim().toUpperCase();
      setName(editing.name);
      setType(editing.type);
      setCurrency(isSupportedCurrency(normalizedCurrency) ? normalizedCurrency : 'ARS');
      setInitialBalance(String(editing.initial_balance));
      setColor(editing.color || defaultColorForType(editing.type));
      setColorTouched(true);
      setIsDefault(editing.is_default === 1);
      setDueDay(editing.due_day ? String(editing.due_day) : '');
    } else {
      setName('');
      setType(defaultType);
      setCurrency('ARS');
      setInitialBalance('0');
      setColor(defaultColorForType(defaultType));
      setColorTouched(false);
      setIsDefault(false);
      setDueDay('');
    }
  }, [open, editing, defaultType]);

  if (!open) return null;

  const handleTypeChange = (nextType: AccountType) => {
    setType(nextType);
    if (nextType === 'credit_card') {
      setIsDefault(false);
    }
    if (!editing && !colorTouched) {
      setColor(defaultColorForType(nextType));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    const numInitial = Number(initialBalance || 0);
    if (!cleanName) {
      setError('Ingresá un nombre para la cuenta.');
      return;
    }
    if (!Number.isFinite(numInitial)) {
      setError('Ingresá un saldo inicial válido.');
      return;
    }

    let parsedDueDay: number | null = null;
    if (type === 'credit_card' && dueDay.trim() !== '') {
      const dayNum = Number(dueDay);
      if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
        setError('El día de vencimiento debe ser un entero entre 1 y 31.');
        return;
      }
      parsedDueDay = dayNum;
    }

    setSaving(true);
    setError('');
    try {
      const payload = {
        name: cleanName,
        type,
        currency,
        initial_balance: numInitial,
        color,
        is_default: type === 'credit_card' ? 0 : isDefault ? 1 : 0,
        due_day: type === 'credit_card' ? parsedDueDay : null,
      };
      if (editing) {
        await onUpdate(editing.id, payload);
      } else {
        await onCreate(payload);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la cuenta');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!window.confirm(`¿Eliminar "${editing.name}"?`)) return;
    setSaving(true);
    setError('');
    try {
      await onDelete(editing.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la cuenta');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-xs">
      <div className="my-auto w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">
            {editing
              ? `Editar ${editing.type === 'credit_card' ? 'tarjeta' : 'cuenta'}`
              : type === 'credit_card'
                ? 'Nueva tarjeta de crédito'
                : 'Nueva cuenta'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Nombre</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Banco Principal, Billetera, Tarjeta..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Tipo</label>
              <select
                value={type}
                onChange={(e) => handleTypeChange(e.target.value as AccountType)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Moneda</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {CURRENCY_LABELS[c]}
                  </option>
                ))}
              </select>
              {editing && !isSupportedCurrency(editing.currency.trim().toUpperCase()) && (
                <p className="mt-1 text-[11px] text-amber-300">
                  Moneda original &ldquo;{editing.currency}&rdquo; no soportada; se guardará en{' '}
                  {currency}.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-400">Saldo inicial</label>
            <input
              type="number"
              step="0.01"
              value={initialBalance}
              onChange={(e) => setInitialBalance(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
            {type === 'credit_card' && (
              <p className="mt-1 text-[11px] text-zinc-500">
                Usá un monto negativo si ya tenés deuda acumulada al arrancar.
              </p>
            )}
          </div>

          {type === 'credit_card' && (
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                Día de vencimiento del resumen (1-31, opc.)
              </label>
              <input
                type="number"
                min="1"
                max="31"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                placeholder="Ej: 10"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                Si pasa este día con resumen pendiente, la tarjeta te avisa como vencida.
              </p>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs text-zinc-400">Color</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_SWATCHES.map((swatch) => {
                const active = color.toLowerCase() === swatch.toLowerCase();
                return (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => {
                      setColor(swatch);
                      setColorTouched(true);
                    }}
                    aria-label={`Color ${swatch}`}
                    className={`h-7 w-7 rounded-full border transition ${
                      active ? 'scale-110 border-white ring-2 ring-emerald-400' : 'border-zinc-700'
                    }`}
                    style={{ backgroundColor: swatch }}
                  />
                );
              })}
            </div>
          </div>

          {type !== 'credit_card' && (
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
              />
              Cuenta principal por defecto
            </label>
          )}

          {error && (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            {editing ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleDelete()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/15 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Eliminar
              </button>
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
                disabled={saving}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
