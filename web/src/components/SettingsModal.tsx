import { useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { formatMoney } from '../api';
import type { AccountType, AccountWithBalance, Category, Tag } from '../types';

interface Props {
  open: boolean;
  accounts: AccountWithBalance[];
  categories: Category[];
  tags: Tag[];
  onClose: () => void;
  onCreateAccount: (defaultType: AccountType) => void;
  onEditAccount: (acc: AccountWithBalance) => void;
  onCreateCategory: (payload: {
    name: string;
    icon: string;
    type: 'expense' | 'income' | 'both';
    color: string;
  }) => Promise<void>;
  onUpdateCategory: (
    id: string,
    patch: { name: string; icon: string; type: 'expense' | 'income' | 'both'; color: string }
  ) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onCreateTag: (name: string, color: string) => Promise<void>;
  onUpdateTag: (id: string, patch: { name: string; color: string }) => Promise<void>;
  onDeleteTag: (id: string) => Promise<void>;
}

const SWATCHES = [
  '#FF9800',
  '#F44336',
  '#29B6F6',
  '#64DD17',
  '#26A69A',
  '#536DFE',
  '#AA00FF',
  '#FBC02D',
  '#9E9E9E',
];

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  wallet: 'Billetera / Banco',
  savings: 'Reservas / Ahorro',
  cash: 'Efectivo',
  credit_card: 'Tarjeta de crédito',
};

export function SettingsModal({
  open,
  accounts,
  categories,
  tags,
  onClose,
  onCreateAccount,
  onEditAccount,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
}: Props) {
  const [tab, setTab] = useState<'accounts' | 'categories' | 'tags'>('accounts');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Category form state
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catIcon, setCatIcon] = useState('📦');
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState<'expense' | 'income' | 'both'>('expense');
  const [catColor, setCatColor] = useState('#FF9800');

  // Tag form state
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#29B6F6');

  if (!open) return null;

  const resetCatForm = () => {
    setEditingCatId(null);
    setCatIcon('📦');
    setCatName('');
    setCatType('expense');
    setCatColor('#FF9800');
  };

  const resetTagForm = () => {
    setEditingTagId(null);
    setTagName('');
    setTagColor('#29B6F6');
  };

  const handleCatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: catName.trim(),
        icon: catIcon.trim() || '📦',
        type: catType,
        color: catColor,
      };
      if (editingCatId) {
        await onUpdateCategory(editingCatId, payload);
      } else {
        await onCreateCategory(payload);
      }
      resetCatForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando categoría');
    } finally {
      setSaving(false);
    }
  };

  const handleTagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = tagName.trim().replace(/^#/, '');
    if (!clean) return;
    setSaving(true);
    setError('');
    try {
      if (editingTagId) {
        await onUpdateTag(editingTagId, { name: clean, color: tagColor });
      } else {
        await onCreateTag(clean, tagColor);
      }
      resetTagForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando etiqueta');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-xs">
      <div className="my-auto w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-white">Configuración del espacio</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-zinc-950 p-1 text-xs font-medium">
          {(
            [
              { id: 'accounts', label: `Cuentas y TC (${accounts.length})` },
              { id: 'categories', label: `Categorías (${categories.length})` },
              { id: 'tags', label: `Etiquetas (${tags.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setError('');
              }}
              className={`rounded-lg py-2 transition ${
                tab === t.id
                  ? 'bg-zinc-800 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}

        {tab === 'accounts' && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onCreateAccount('wallet')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <Plus className="h-3.5 w-3.5" />
                Nueva cuenta
              </button>
              <button
                type="button"
                onClick={() => onCreateAccount('credit_card')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Nueva tarjeta
              </button>
            </div>

            {accounts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
                Todavía no creaste cuentas ni tarjetas. Agregá tu primera cuenta desde los botones de arriba.
              </p>
            ) : (
              <div className="max-h-80 divide-y divide-zinc-800/80 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/60">
                {accounts.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border border-white/20"
                        style={{ backgroundColor: acc.color }}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-zinc-100">
                          {acc.name} {acc.is_default ? '⭐' : ''}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          {ACCOUNT_TYPE_LABELS[acc.type]} · {acc.currency}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-200 tabular-nums">
                        {formatMoney(acc.balance, acc.currency)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onEditAccount(acc)}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                        title="Editar cuenta"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'categories' && (
          <div className="mt-4 space-y-3">
            <form
              onSubmit={handleCatSubmit}
              className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3"
            >
              <div className="grid grid-cols-12 gap-2">
                <input
                  type="text"
                  value={catIcon}
                  onChange={(e) => setCatIcon(e.target.value)}
                  placeholder="📦"
                  className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-center text-sm text-white outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  required
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder={editingCatId ? 'Editar nombre...' : 'Nueva categoría...'}
                  className="col-span-6 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-white outline-none focus:border-emerald-500"
                />
                <select
                  value={catType}
                  onChange={(e) => setCatType(e.target.value as 'expense' | 'income' | 'both')}
                  className="col-span-4 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
                >
                  <option value="expense">Gasto</option>
                  <option value="income">Ingreso</option>
                  <option value="both">Ambos</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {SWATCHES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setCatColor(s)}
                      className={`h-5 w-5 rounded-full border ${
                        catColor === s ? 'scale-110 border-white ring-1 ring-emerald-400' : 'border-zinc-700'
                      }`}
                      style={{ backgroundColor: s }}
                    />
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {editingCatId && (
                    <button
                      type="button"
                      onClick={resetCatForm}
                      className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                    >
                      Cancelar
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {editingCatId ? 'Actualizar' : 'Agregar'}
                  </button>
                </div>
              </div>
            </form>

            <div className="max-h-72 divide-y divide-zinc-800/80 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/60">
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span>{cat.icon}</span>
                    <span className="truncate font-medium text-zinc-100">{cat.name}</span>
                    <span className="text-[10px] uppercase text-zinc-500">
                      {cat.type === 'income' ? 'Ingreso' : cat.type === 'both' ? 'Ambos' : 'Gasto'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCatId(cat.id);
                        setCatIcon(cat.icon);
                        setCatName(cat.name);
                        setCatType(cat.type);
                        setCatColor(cat.color);
                      }}
                      className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`¿Eliminar categoría "${cat.name}"?`)) return;
                        setError('');
                        try {
                          await onDeleteCategory(cat.id);
                          if (editingCatId === cat.id) resetCatForm();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'No se pudo eliminar');
                        }
                      }}
                      className="rounded-lg p-1 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-400"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'tags' && (
          <div className="mt-4 space-y-3">
            <form
              onSubmit={handleTagSubmit}
              className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  required
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  placeholder={editingTagId ? 'Editar etiqueta...' : 'Nueva etiqueta (ej. viaje)'}
                  className="min-w-[180px] flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-white outline-none focus:border-emerald-500"
                />
                <div className="flex flex-wrap gap-1.5">
                  {SWATCHES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setTagColor(s)}
                      className={`h-5 w-5 rounded-full border ${
                        tagColor === s ? 'scale-110 border-white ring-1 ring-emerald-400' : 'border-zinc-700'
                      }`}
                      style={{ backgroundColor: s }}
                    />
                  ))}
                </div>
                {editingTagId && (
                  <button
                    type="button"
                    onClick={resetTagForm}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {editingTagId ? 'Actualizar' : 'Agregar'}
                </button>
              </div>
            </form>

            <div className="max-h-72 divide-y divide-zinc-800/80 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/60">
              {tags.length === 0 ? (
                <p className="p-4 text-center text-xs text-zinc-500">Sin etiquetas creadas.</p>
              ) : (
                tags.map((tag) => (
                  <div key={tag.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="font-medium text-zinc-100">#{tag.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTagId(tag.id);
                          setTagName(tag.name);
                          setTagColor(tag.color);
                        }}
                        className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`¿Eliminar etiqueta #${tag.name}?`)) return;
                          await onDeleteTag(tag.id);
                          if (editingTagId === tag.id) resetTagForm();
                        }}
                        className="rounded-lg p-1 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-400"
                        title="Eliminar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
