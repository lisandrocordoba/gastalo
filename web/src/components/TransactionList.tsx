import { useMemo, useState } from 'react';
import { ArrowRight, ArrowUpDown, Pencil, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { formatMoney } from '../api';
import type { AccountWithBalance, Category, Tag, Transaction, TransactionType } from '../types';

interface Props {
  transactions: Transaction[];
  accounts: AccountWithBalance[];
  categories: Category[];
  tags: Tag[];
  selectedAccount: string;
  onSelectAccount: (accountId: string) => void;
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  selectedTag: string;
  onSelectTag: (tagId: string) => void;
  cardPurchasesOnly: boolean;
  onToggleCardPurchasesOnly: (next: boolean) => void;
  onEdit: (tx: Transaction) => void;
  onDelete: (id: string) => Promise<void>;
}

type SortKey = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

const TYPE_LABELS: Record<TransactionType, string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  transfer: 'Transferencia',
  investment: 'Inversión',
  third_party: 'Tercero',
  third_party_repayment: 'Reembolso',
  adjustment: 'Ajuste',
};

function typeBadge(tx: Transaction, catIcon?: string): { icon: string; color: string; prefix: string } {
  switch (tx.type) {
    case 'income':
      return { icon: catIcon ?? '💚', color: 'text-[#FBC02D]', prefix: '+' };
    case 'transfer':
      return { icon: '🔁', color: 'text-sky-400', prefix: '' };
    case 'investment':
      return { icon: '🪙', color: 'text-[#FF4081]', prefix: '-' };
    case 'third_party':
      return { icon: '🤝', color: 'text-[#00BFA5]', prefix: '-' };
    case 'third_party_repayment':
      return { icon: '💸', color: 'text-[#00BFA5]', prefix: '+' };
    case 'adjustment':
      return {
        icon: '⚖️',
        color: tx.amount >= 0 ? 'text-emerald-300' : 'text-rose-300',
        prefix: tx.amount >= 0 ? '+' : '',
      };
    default:
      return { icon: catIcon ?? '📦', color: 'text-zinc-100', prefix: '-' };
  }
}

function accountPillStyle(acc?: AccountWithBalance): string {
  if (!acc) return 'border-zinc-700 bg-zinc-900 text-zinc-300';
  if (acc.type === 'cash') {
    return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300';
  }
  if (acc.type === 'credit_card') {
    return 'border-zinc-700 bg-black text-zinc-200';
  }
  return 'border-[#009EE3]/45 bg-[#009EE3]/15 text-[#38BDF8]';
}

export function TransactionList({
  transactions,
  accounts,
  categories,
  tags,
  selectedAccount,
  onSelectAccount,
  selectedCategory,
  onSelectCategory,
  selectedTag,
  onSelectTag,
  cardPurchasesOnly,
  onToggleCardPurchasesOnly,
  onEdit,
  onDelete,
}: Props) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('date_desc');

  const accMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const cardAccountIds = useMemo(
    () => new Set(accounts.filter((a) => a.type === 'credit_card').map((a) => a.id)),
    [accounts]
  );
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const hasFilters = Boolean(
    search.trim() ||
      selectedAccount ||
      selectedCategory ||
      typeFilter ||
      selectedTag ||
      cardPurchasesOnly ||
      sortBy !== 'date_desc'
  );

  const clearAllFilters = () => {
    setSearch('');
    onSelectAccount('');
    onSelectCategory('');
    setTypeFilter('');
    onSelectTag('');
    onToggleCardPurchasesOnly(false);
    setSortBy('date_desc');
  };

  const filtered = useMemo(() => {
    const base = transactions.filter((tx) => {
      if (cardPurchasesOnly && !(tx.type === 'expense' && cardAccountIds.has(tx.account_id))) {
        return false;
      }
      if (
        selectedAccount &&
        tx.account_id !== selectedAccount &&
        tx.to_account_id !== selectedAccount
      ) {
        return false;
      }
      if (selectedCategory && tx.category_id !== selectedCategory) {
        return false;
      }
      if (typeFilter && tx.type !== typeFilter) {
        return false;
      }
      if (selectedTag && !tx.tags.includes(selectedTag)) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchDesc = tx.description.toLowerCase().includes(q);
        const matchThird = (tx.third_party_name ?? '').toLowerCase().includes(q);
        if (!matchDesc && !matchThird) return false;
      }
      return true;
    });

    return [...base].sort((a, b) => {
      if (sortBy === 'date_asc') {
        return a.occurred_at.localeCompare(b.occurred_at) || a.created_at.localeCompare(b.created_at);
      }
      if (sortBy === 'amount_desc') {
        return Math.abs(b.amount) - Math.abs(a.amount);
      }
      if (sortBy === 'amount_asc') {
        return Math.abs(a.amount) - Math.abs(b.amount);
      }
      return b.occurred_at.localeCompare(a.occurred_at) || b.created_at.localeCompare(a.created_at);
    });
  }, [
    transactions,
    cardPurchasesOnly,
    cardAccountIds,
    selectedAccount,
    selectedCategory,
    typeFilter,
    selectedTag,
    search,
    sortBy,
  ]);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-200">
              Movimientos ({filtered.length})
            </h3>
            {cardPurchasesOnly && (
              <button
                type="button"
                onClick={() => onToggleCardPurchasesOnly(false)}
                className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/15 px-2.5 py-0.5 text-[11px] font-medium text-violet-200 hover:bg-violet-500/25"
              >
                💳 Solo compras con TC
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-medium text-emerald-400 transition hover:border-emerald-500/60 hover:bg-zinc-800"
            >
              <RotateCcw className="h-3 w-3" />
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar descripción o tercero..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-500"
            />
          </div>

          <div className="inline-flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300">
            <ArrowUpDown className="h-3.5 w-3.5 text-zinc-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              aria-label="Ordenar movimientos"
              className="bg-transparent text-xs text-zinc-200 outline-none"
            >
              <option value="date_desc" className="bg-zinc-900">Fecha ↓ (reciente)</option>
              <option value="date_asc" className="bg-zinc-900">Fecha ↑ (antigua)</option>
              <option value="amount_desc" className="bg-zinc-900">Monto ↓ (mayor)</option>
              <option value="amount_asc" className="bg-zinc-900">Monto ↑ (menor)</option>
            </select>
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
          >
            <option value="">Todos los tipos</option>
            {(Object.keys(TYPE_LABELS) as TransactionType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>

          <select
            value={selectedAccount}
            onChange={(e) => onSelectAccount(e.target.value)}
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
          >
            <option value="">Todas las cuentas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            value={selectedCategory}
            onChange={(e) => onSelectCategory(e.target.value)}
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
          >
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>

          <select
            value={selectedTag}
            onChange={(e) => onSelectTag(e.target.value)}
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
          >
            <option value="">Todas las etiquetas</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-zinc-500">
          No hay movimientos para mostrar con estos filtros.
        </div>
      ) : (
        <div className="mt-4 divide-y divide-zinc-800/80">
          {filtered.map((tx) => {
            const acc = accMap.get(tx.account_id);
            const toAcc = tx.to_account_id ? accMap.get(tx.to_account_id) : null;
            const cat = tx.category_id ? catMap.get(tx.category_id) : null;
            const badge = typeBadge(tx, cat?.icon);

            return (
              <div
                key={tx.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-lg"
                    style={
                      tx.type === 'investment'
                        ? { borderColor: '#FF408155', backgroundColor: '#FF408115' }
                        : cat?.color
                          ? { borderColor: `${cat.color}44` }
                          : undefined
                    }
                  >
                    {badge.icon}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-zinc-100">{tx.description}</p>
                      {tx.installments_total && tx.installments_total > 1 ? (
                        <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300 tabular-nums">
                          {tx.installments_total} cuotas
                        </span>
                      ) : null}
                      {tx.statement_month ? (
                        <span className="rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 tabular-nums">
                          Resumen {tx.statement_month}
                        </span>
                      ) : null}
                      {tx.third_party_name ? (
                        <span className="rounded-md bg-[#00BFA5]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#00BFA5]">
                          🤝 {tx.third_party_name}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                      <span className="tabular-nums">{tx.occurred_at}</span>
                      <button
                        type="button"
                        onClick={() =>
                          onSelectAccount(selectedAccount === tx.account_id ? '' : tx.account_id)
                        }
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition hover:border-emerald-500/60 ${accountPillStyle(acc)}`}
                      >
                        {acc?.name ?? tx.account_id}
                      </button>
                      {tx.type === 'transfer' && toAcc ? (
                        <>
                          <ArrowRight className="h-3 w-3 text-zinc-500" />
                          <button
                            type="button"
                            onClick={() =>
                              onSelectAccount(selectedAccount === toAcc.id ? '' : toAcc.id)
                            }
                            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition hover:border-emerald-500/60 ${accountPillStyle(toAcc)}`}
                          >
                            {toAcc.name}
                          </button>
                        </>
                      ) : cat ? (
                        <button
                          type="button"
                          onClick={() =>
                            onSelectCategory(selectedCategory === cat.id ? '' : cat.id)
                          }
                          className="text-zinc-400 transition hover:text-zinc-100"
                        >
                          {cat.name}
                        </button>
                      ) : (
                        <span className="text-zinc-400">{TYPE_LABELS[tx.type]}</span>
                      )}

                      {tx.tags.map((tagId) => {
                        const t = tagMap.get(tagId);
                        return (
                          <button
                            key={tagId}
                            type="button"
                            onClick={() => onSelectTag(selectedTag === tagId ? '' : tagId)}
                            className="rounded-md border border-zinc-700/80 bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:border-emerald-500/60"
                            style={t ? { borderColor: `${t.color}66` } : undefined}
                          >
                            #{t?.name ?? tagId}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className={`text-sm font-semibold tabular-nums ${badge.color}`}>
                    {badge.prefix}
                    {formatMoney(tx.amount, tx.currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onEdit(tx)}
                    title="Editar"
                    className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`¿Eliminar "${tx.description}"?`)) {
                        void onDelete(tx.id);
                      }
                    }}
                    title="Eliminar"
                    className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-rose-500/15 hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
