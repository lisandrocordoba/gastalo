import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, KeyRound, Plus, RefreshCw } from 'lucide-react';
import {
  createRecurringItem,
  createSharedPurchase,
  createTag,
  createTransaction,
  deleteRecurringItem,
  deleteTransaction,
  downloadCsv,
  fetchBootstrap,
  getStoredToken,
  reconcileAccount,
  setStoredToken,
  UnauthorizedError,
  updateAccountInitialBalance,
  updateRecurringItem,
  updateTransaction,
} from './api';
import { AccountsGrid } from './components/AccountsGrid';
import { CategoryChart } from './components/CategoryChart';
import { FutureProjectionCard } from './components/FutureProjectionCard';
import { MonthlyChart } from './components/MonthlyChart';
import { SummaryCards } from './components/SummaryCards';
import { TagsPanel } from './components/TagsPanel';
import { TransactionList } from './components/TransactionList';
import { TransactionModal } from './components/TransactionModal';
import type { BootstrapResponse, Transaction } from './types';

function currentMonthStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function todayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function App() {
  const [month, setMonth] = useState(currentMonthStr);
  const [data, setData] = useState<BootstrapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [tokenInput, setTokenInput] = useState(getStoredToken);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [selectedTag, setSelectedTag] = useState('');

  const loadData = useCallback(async (targetMonth: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchBootstrap(targetMonth);
      setData(res);
      setNeedsAuth(false);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setNeedsAuth(true);
      } else {
        setError(err instanceof Error ? err.message : 'Error cargando datos');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  }, []);

  useEffect(() => {
    void loadData(month);
  }, [month, loadData]);

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStoredToken(tokenInput.trim());
    void loadData(month);
  };

  if (needsAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <form
          onSubmit={handleAuthSubmit}
          className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
        >
          <div className="flex items-center gap-2 text-emerald-400">
            <KeyRound className="h-5 w-5" />
            <h1 className="text-lg font-bold text-zinc-100">Gasti Personal</h1>
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Ingresá tu <code className="text-zinc-200">DASHBOARD_TOKEN</code> para acceder al panel
            (o abrilo directo desde Telegram).
          </p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Token de acceso"
            className="mt-4 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Entrar
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 pb-12 text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">Gasti Personal</h1>
            <p className="text-xs text-zinc-400">
              Mercado Pago · Reservas · TC BBVA · TC MP · Efectivo
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-900 px-1 py-1">
              <button
                type="button"
                onClick={() => setMonth((m) => shiftMonth(m, -1))}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2.5 text-xs font-semibold text-zinc-200">{month}</span>
              <button
                type="button"
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => void loadData(month)}
              title="Actualizar"
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => void downloadCsv(month)}
              title="Exportar CSV"
              className="hidden items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 sm:inline-flex"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingTx(null);
                setModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" />
              Nuevo
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-5 max-w-6xl space-y-6 px-4">
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
            {error}
          </div>
        )}

        {data ? (
          <>
            <SummaryCards summary={data.summary} />

            <AccountsGrid
              accounts={data.accounts}
              onSaveInitialBalance={async (id, initial) => {
                await updateAccountInitialBalance(id, initial);
                await loadData(month);
              }}
              onReconcileBalance={async (id, realBalance) => {
                await reconcileAccount(id, realBalance);
                await loadData(month);
              }}
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <CategoryChart data={data.summary.by_category} />
              <MonthlyChart data={data.monthlyHistory} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <TagsPanel
                byTag={data.summary.by_tag}
                thirdPartyByPerson={data.summary.third_party_by_person}
                selectedTagId={selectedTag}
                onSelectTag={setSelectedTag}
              />
              <div className="lg:col-span-2">
                <FutureProjectionCard
                  projection={data.projection}
                  recurringItems={data.recurringItems}
                  accounts={data.accounts}
                  categories={data.categories}
                  onCreateRecurring={async (input) => {
                    await createRecurringItem(input);
                    await loadData(month);
                  }}
                  onToggleRecurring={async (id, active) => {
                    await updateRecurringItem(id, { active });
                    await loadData(month);
                  }}
                  onDeleteRecurring={async (id) => {
                    await deleteRecurringItem(id);
                    await loadData(month);
                  }}
                />
              </div>
            </div>

            <TransactionList
              transactions={data.transactions}
              accounts={data.accounts}
              categories={data.categories}
              tags={data.tags}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
              onEdit={(tx) => {
                setEditingTx(tx);
                setModalOpen(true);
              }}
              onDelete={async (id) => {
                await deleteTransaction(id);
                await loadData(month);
              }}
            />
          </>
        ) : (
          <div className="py-20 text-center text-sm text-zinc-500">Cargando finanzas...</div>
        )}
      </main>

      {data && (
        <TransactionModal
          open={modalOpen}
          editing={editingTx}
          accounts={data.accounts}
          categories={data.categories}
          tags={data.tags}
          defaultDate={todayStr()}
          onClose={() => setModalOpen(false)}
          onCreateTag={async (name) => {
            const res = await createTag(name);
            await loadData(month);
            return res.tag;
          }}
          onSubmit={async (payload) => {
            if (payload.id) {
              await updateTransaction(payload.id, payload);
            } else {
              await createTransaction(payload);
            }
            await loadData(month);
          }}
          onSubmitShared={async (payload) => {
            await createSharedPurchase(payload);
            await loadData(month);
          }}
        />
      )}
    </div>
  );
}
export default App;
