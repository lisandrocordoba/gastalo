import { useMemo, useState } from 'react';
import { ArrowRight, Pencil, Search, Trash2 } from 'lucide-react';
import { formatMoney } from '../api';
import type { AccountWithBalance, Category, Transaction } from '../types';

interface Props {
  transactions: Transaction[];
  accounts: AccountWithBalance[];
  categories: Category[];
  onEdit: (tx: Transaction) => void;
  onDelete: (id: string) => Promise<void>;
}

export function TransactionList({ transactions, accounts, categories, onEdit, onDelete }: Props) {
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const accMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      if (accountFilter && tx.account_id !== accountFilter && tx.to_account_id !== accountFilter) {
        return false;
      }
      if (categoryFilter && tx.category_id !== categoryFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!tx.description.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [transactions, accountFilter, categoryFilter, search]);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">
          Movimientos ({filtered.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 sm:w-52 sm:flex-initial">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar descripción..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-xs text-zinc-100 outline-none focus:border-emerald-500"
            />
          </div>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
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
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
          >
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
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

            const amountClass =
              tx.type === 'income'
                ? 'text-emerald-400'
                : tx.type === 'transfer'
                  ? 'text-sky-400'
                  : 'text-zinc-100';
            const prefix = tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : '';

            return (
              <div
                key={tx.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-800/90 text-lg">
                    {tx.type === 'transfer' ? '🔁' : (cat?.icon ?? '📦')}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">{tx.description}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-400">
                      <span>{tx.occurred_at}</span>
                      <span>·</span>
                      {tx.type === 'transfer' && toAcc ? (
                        <span className="inline-flex items-center gap-1 text-sky-300">
                          {acc?.name ?? tx.account_id} <ArrowRight className="h-3 w-3" /> {toAcc.name}
                        </span>
                      ) : (
                        <span>
                          {acc?.name ?? tx.account_id}
                          {cat ? ` · ${cat.name}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className={`text-sm font-semibold ${amountClass}`}>
                    {prefix}
                    {formatMoney(tx.amount, tx.currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onEdit(tx)}
                    title="Editar"
                    className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
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
                    className="rounded-lg p-1.5 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-400"
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
