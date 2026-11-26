import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { CreateSharedPurchasePayload, CreateTransactionPayload } from '../api';
import {
  SUPPORTED_CURRENCIES,
  type AccountWithBalance,
  type Category,
  type SupportedCurrency,
  type Tag,
  type Transaction,
  type TransactionType,
} from '../types';

interface Props {
  open: boolean;
  editing: Transaction | null;
  accounts: AccountWithBalance[];
  categories: Category[];
  tags: Tag[];
  defaultDate: string;
  onClose: () => void;
  onCreateTag: (name: string) => Promise<Tag>;
  onSubmit: (payload: CreateTransactionPayload & { id?: string }) => Promise<void>;
  onSubmitShared: (payload: CreateSharedPurchasePayload) => Promise<void>;
}

const MODAL_TYPES: { id: TransactionType; label: string }[] = [
  { id: 'expense', label: 'Gasto' },
  { id: 'income', label: 'Ingreso' },
  { id: 'transfer', label: 'Transferencia' },
  { id: 'investment', label: 'Inversión' },
  { id: 'third_party', label: 'Tercero' },
  { id: 'third_party_repayment', label: 'Reembolso' },
];

function nextMonthFromDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(dateStr.trim());
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    if (Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12) {
      const d = new Date(Date.UTC(y, m, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    }
  }
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function TransactionModal({
  open,
  editing,
  accounts,
  categories,
  tags,
  defaultDate,
  onClose,
  onCreateTag,
  onSubmit,
  onSubmitShared,
}: Props) {
  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('ARS');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState(defaultDate);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [installments, setInstallments] = useState('');
  const [firstInstallmentMonth, setFirstInstallmentMonth] = useState('');
  const [budgetMonth, setBudgetMonth] = useState('');
  const [thirdPartyName, setThirdPartyName] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [sharedAmount, setSharedAmount] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);
  const [saving, setSaving] = useState(false);
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
    setNewTagInput('');
    setCreatingTag(false);
    const defAcc =
      accounts.find((a) => a.is_default === 1 && a.type !== 'credit_card') ??
      accounts.find((a) => a.type !== 'credit_card') ??
      accounts[0];
    const defAccId = defAcc?.id ?? '';
    const defCurrency = defAcc?.currency ?? 'ARS';
    const defToAcc =
      accounts.find(
        (a) => a.type === 'savings' && a.id !== defAccId && a.currency === defCurrency
      ) ?? accounts.find((a) => a.id !== defAccId && a.currency === defCurrency);
    const defExpenseCat = categories.find((c) => c.type === 'expense' || c.type === 'both')?.id ?? '';

    if (editing) {
      const editAcc = accounts.find((a) => a.id === editing.account_id);
      const editCurrency = editAcc?.currency ?? editing.currency;
      const validEditTargets = accounts.filter(
        (a) => a.id !== editing.account_id && a.currency === editCurrency
      );
      const preferredEditTo =
        (editing.to_account_id && validEditTargets.some((a) => a.id === editing.to_account_id)
          ? editing.to_account_id
          : null) ??
        validEditTargets.find((a) => a.type === 'savings')?.id ??
        validEditTargets[0]?.id ??
        '';
      setType(editing.type);
      setAmount(String(editing.amount));
      setCurrency(editCurrency);
      setAccountId(editing.account_id);
      setToAccountId(preferredEditTo);
      setCategoryId(editing.category_id ?? '');
      setDescription(editing.description);
      setOccurredAt(editing.occurred_at);
      setSelectedTags(editing.tags ?? []);
      setInstallments(
        editing.installments_total && editing.installments_total > 1
          ? String(editing.installments_total)
          : ''
      );
      setFirstInstallmentMonth(editing.first_installment_month ?? '');
      setBudgetMonth(editing.budget_month ?? '');
      setThirdPartyName(editing.third_party_name ?? '');
      setIsShared(false);
      setSharedAmount('');
    } else {
      setType('expense');
      setAmount('');
      setCurrency(defCurrency);
      setAccountId(defAccId);
      setToAccountId(defToAcc?.id ?? '');
      setCategoryId(defExpenseCat);
      setDescription('');
      setOccurredAt(defaultDate);
      setSelectedTags([]);
      setInstallments('');
      setFirstInstallmentMonth(nextMonthFromDate(defaultDate));
      setBudgetMonth('');
      setThirdPartyName('');
      setIsShared(false);
      setSharedAmount('');
    }
  }, [open, editing, accounts, categories, defaultDate]);

  if (!open) return null;

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const effectiveCurrency = selectedAccount?.currency ?? currency;
  const transferTargets = accounts.filter(
    (a) => a.id !== accountId && a.currency === effectiveCurrency
  );
  const isCreditCard = selectedAccount?.type === 'credit_card';
  const showCategory = type === 'expense' || type === 'income';
  const showThirdPartyField =
    type === 'third_party' || type === 'third_party_repayment' || (type === 'expense' && isShared);
  const filteredCategories = categories.filter((c) =>
    type === 'income' ? c.type === 'income' || c.type === 'both' : c.type === 'expense' || c.type === 'both'
  );

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  };

  const handleAddTag = async () => {
    const clean = newTagInput.trim().replace(/^#/, '');
    if (!clean || creatingTag) return;
    setCreatingTag(true);
    setError('');
    try {
      const created = await onCreateTag(clean);
      setSelectedTags((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
      setNewTagInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la etiqueta');
    } finally {
      setCreatingTag(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || (type === 'adjustment' ? numAmount === 0 : numAmount <= 0)) {
      setError('Ingresá un monto válido.');
      return;
    }
    if (!description.trim()) {
      setError('Ingresá una descripción.');
      return;
    }
    if (isCreditCard && (type === 'transfer' || type === 'investment')) {
      setError('No podés registrar transferencias ni inversiones desde una tarjeta de crédito.');
      return;
    }
    if (type === 'transfer') {
      if (transferTargets.length === 0 || !toAccountId) {
        setError(`No hay otra cuenta en ${effectiveCurrency} disponible como destino.`);
        return;
      }
      const targetAcc = accounts.find((a) => a.id === toAccountId);
      if (!targetAcc || targetAcc.id === accountId) {
        setError('La cuenta origen y destino deben ser distintas.');
        return;
      }
      if (targetAcc.currency !== effectiveCurrency) {
        setError('Las transferencias deben ser entre cuentas de la misma moneda.');
        return;
      }
    }

    const parsedInst = installments ? Math.trunc(Number(installments)) : null;
    if (parsedInst !== null && (!Number.isFinite(parsedInst) || parsedInst < 2)) {
      setError('Las cuotas deben ser 2 o más.');
      return;
    }

    if (!editing && type === 'expense' && isShared) {
      const thirdAmt = Number(sharedAmount);
      if (!thirdPartyName.trim()) {
        setError('Indicá el nombre del tercero para dividir la compra.');
        return;
      }
      if (!Number.isFinite(thirdAmt) || thirdAmt <= 0 || thirdAmt >= numAmount) {
        setError('La parte del tercero debe ser mayor a 0 y menor al total.');
        return;
      }

      setSaving(true);
      setError('');
      try {
        await onSubmitShared({
          account_id: accountId,
          currency: effectiveCurrency,
          category_id: categoryId || null,
          description: description.trim(),
          occurred_at: occurredAt,
          own_amount: Math.round((numAmount - thirdAmt) * 100) / 100,
          third_party_amount: Math.round(thirdAmt * 100) / 100,
          third_party_name: thirdPartyName.trim(),
          installments_total: isCreditCard ? parsedInst : null,
          first_installment_month:
            isCreditCard && parsedInst
              ? firstInstallmentMonth || nextMonthFromDate(occurredAt)
              : null,
          tags: selectedTags,
        });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al guardar');
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSubmit({
        id: editing?.id,
        type,
        amount: numAmount,
        currency: effectiveCurrency,
        account_id: accountId,
        to_account_id: type === 'transfer' ? toAccountId : null,
        category_id: showCategory ? categoryId || null : null,
        description: description.trim(),
        occurred_at: occurredAt,
        tags: selectedTags,
        installments_total: isCreditCard ? parsedInst : null,
        first_installment_month:
          isCreditCard && parsedInst
            ? firstInstallmentMonth || nextMonthFromDate(occurredAt)
            : null,
        budget_month:
          (type === 'income' || type === 'expense') && budgetMonth ? budgetMonth : null,
        third_party_name: showThirdPartyField ? thirdPartyName.trim() || null : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-xs">
      <div className="my-auto w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
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
          {editing?.type === 'adjustment' ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
              Tipo: <strong>Ajuste de conciliación</strong>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-zinc-950 p-1">
              {MODAL_TYPES.map((t) => {
                const disabledForCard =
                  isCreditCard && (t.id === 'transfer' || t.id === 'investment');
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={disabledForCard}
                    onClick={() => {
                      setType(t.id);
                      if (t.id === 'income') {
                        setCategoryId(
                          categories.find((c) => c.type === 'income' || c.type === 'both')?.id ?? ''
                        );
                      }
                      if (t.id === 'expense') {
                        setCategoryId(
                          categories.find((c) => c.type === 'expense' || c.type === 'both')?.id ?? ''
                        );
                      }
                      if (t.id === 'transfer') {
                        const validTargets = accounts.filter(
                          (a) => a.id !== accountId && a.currency === effectiveCurrency
                        );
                        if (!validTargets.some((a) => a.id === toAccountId)) {
                          const preferredTarget =
                            validTargets.find((a) => a.type === 'savings') ?? validTargets[0];
                          setToAccountId(preferredTarget?.id ?? '');
                        }
                      }
                      if (t.id !== 'expense') setIsShared(false);
                    }}
                    className={`rounded-lg py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      type === t.id
                        ? 'bg-zinc-800 text-white shadow'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-zinc-400">
                {isShared ? 'Monto total pagado' : 'Monto'}
              </label>
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
                value={effectiveCurrency}
                disabled
                title="La moneda se sincroniza automáticamente con la cuenta seleccionada"
                className="w-full cursor-not-allowed rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-300 opacity-80 outline-none"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                {!SUPPORTED_CURRENCIES.includes(effectiveCurrency as SupportedCurrency) && (
                  <option value={effectiveCurrency}>{effectiveCurrency}</option>
                )}
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
              placeholder="Ej: Alquiler cancha fútbol"
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
                onChange={(e) => {
                  const nextAccId = e.target.value;
                  setAccountId(nextAccId);
                  const nextAcc = accounts.find((a) => a.id === nextAccId);
                  const nextCurrency = nextAcc?.currency ?? 'ARS';
                  setCurrency(nextCurrency);
                  const validTargets = accounts.filter(
                    (a) => a.id !== nextAccId && a.currency === nextCurrency
                  );
                  if (!validTargets.some((a) => a.id === toAccountId)) {
                    const preferredTarget =
                      validTargets.find((a) => a.type === 'savings') ?? validTargets[0];
                    setToAccountId(preferredTarget?.id ?? '');
                  }
                }}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              >
                {accounts.map((a) => (
                  <option
                    key={a.id}
                    value={a.id}
                    disabled={(type === 'transfer' || type === 'investment') && a.type === 'credit_card'}
                  >
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            {type === 'transfer' ? (
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Cuenta destino</label>
                {transferTargets.length === 0 ? (
                  <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    No hay otra cuenta en {effectiveCurrency} para transferir.
                  </p>
                ) : (
                  <select
                    value={toAccountId}
                    onChange={(e) => setToAccountId(e.target.value)}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                  >
                    {transferTargets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : showCategory ? (
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Categoría</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                >
                  <option value="">Sin categoría</option>
                  {filteredCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
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
            )}
          </div>

          {(type === 'transfer' || showCategory) && (
            <div className={showCategory ? 'grid grid-cols-2 gap-2' : undefined}>
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
              {showCategory && (
                <div>
                  <div className="mb-1 flex items-center justify-between gap-1">
                    <label className="text-xs text-zinc-400">Mes contable (opc.)</label>
                    <button
                      type="button"
                      onClick={() => setBudgetMonth(nextMonthFromDate(occurredAt))}
                      className="text-[10px] font-medium text-emerald-400 hover:underline"
                    >
                      Mes sig.
                    </button>
                  </div>
                  <input
                    type="month"
                    value={budgetMonth}
                    onChange={(e) => setBudgetMonth(e.target.value)}
                    title="Opcional: asigná este movimiento al presupuesto de otro mes (ej. sueldo cobrado a fin de mes)"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                  />
                </div>
              )}
            </div>
          )}

          {!editing && type === 'expense' && (
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={isShared}
                onChange={(e) => setIsShared(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
              />
              Compra compartida (dividir parte de tercero)
            </label>
          )}

          {showThirdPartyField && (
            <div className={`grid gap-2 ${isShared ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Tercero (persona)</label>
                <input
                  type="text"
                  value={thirdPartyName}
                  onChange={(e) => setThirdPartyName(e.target.value)}
                  placeholder="Ej: Persona / Amigo"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
              </div>
              {isShared && (
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Parte del tercero</label>
                  <input
                    type="number"
                    step="0.01"
                    value={sharedAmount}
                    onChange={(e) => setSharedAmount(e.target.value)}
                    placeholder="22000"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                  />
                </div>
              )}
            </div>
          )}

          {isCreditCard && (type === 'expense' || type === 'third_party') && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Cuotas (opcional)</label>
                <input
                  type="number"
                  min="2"
                  max="48"
                  value={installments}
                  onChange={(e) => setInstallments(e.target.value)}
                  placeholder="Ej: 3"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">1ra cuota (YYYY-MM)</label>
                <input
                  type="month"
                  value={firstInstallmentMonth}
                  onChange={(e) => setFirstInstallmentMonth(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs text-zinc-400">Etiquetas</label>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const active = selectedTags.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.id)}
                    className={`rounded-lg border px-2 py-1 text-xs transition ${
                      active
                        ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-300'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    #{t.name}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-1.5">
              <input
                type="text"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddTag();
                  }
                }}
                placeholder="Nueva etiqueta..."
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-100 outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                disabled={creatingTag || !newTagInput.trim()}
                onClick={() => void handleAddTag()}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                {creatingTag ? 'Agregando...' : 'Agregar'}
              </button>
            </div>
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
              disabled={saving || (type === 'transfer' && transferTargets.length === 0)}
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
