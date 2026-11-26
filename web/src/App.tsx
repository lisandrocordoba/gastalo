import { useCallback, useEffect, useState } from 'react';
import { Download, KeyRound, Plus, RefreshCw } from 'lucide-react';
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
  payCardStatement,
  reconcileAccount,
  setStoredToken,
  UnauthorizedError,
  updateAccountInitialBalance,
  updateRecurringItem,
  updateTransaction,
} from './api';
import { AccountsGrid } from './components/AccountsGrid';
import { CategoryChart } from './components/CategoryChart';
import { CreditCardsSection } from './components/CreditCardsSection';
import { CurrentStatusBar } from './components/CurrentStatusBar';
import { DateRangePicker, getMonthRange, type DateRangeValue } from './components/DateRangePicker';
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

export function App() {
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => {
    const now = new Date();
    return getMonthRange(now.getFullYear(), now.getMonth() + 1);
  });
  const [statementMonth, setStatementMonth] = useState(currentMonthStr);
  const [data, setData] = useState<BootstrapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [tokenInput, setTokenInput] = useState(getStoredToken);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [cardPurchasesOnly, setCardPurchasesOnly] = useState(false);

  const loadData = useCallback(
    async (range: DateRangeValue, activeStatementMonth: string) => {
      setLoading(true);
      setError('');
      try {
        const res = await fetchBootstrap({
          from: range.from,
          to: range.to,
          basis: 'cash',
          statementMonth: activeStatementMonth,
        });
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
    },
    []
  );

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  }, []);

  useEffect(() => {
    void loadData(dateRange, statementMonth);
  }, [dateRange, statementMonth, loadData]);

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStoredToken(tokenInput.trim());
    void loadData(dateRange, statementMonth);
  };

  const handleSelectAccount = (accountId: string) => {
    setSelectedAccount(accountId);
    if (accountId) {
      setCardPurchasesOnly(false);
    }
  };

  const handleToggleCardPurchasesOnly = (next: boolean) => {
    setCardPurchasesOnly(next);
    if (next) {
      setSelectedAccount('');
    }
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
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">Gasti Personal</h1>
            <p className="text-xs text-zinc-400">
              Mercado Pago · Reservas · Efectivo · Tarjetas de Crédito
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              value={dateRange}
              onChange={(next) => {
                setDateRange(next);
                if (next.mode === 'months') {
                  setStatementMonth(next.from.slice(0, 7));
                }
              }}
            />

            <button
              type="button"
              onClick={() => void loadData(dateRange, statementMonth)}
              title="Actualizar"
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => void downloadCsv(dateRange.from, dateRange.to)}
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
          <div
            role="alert"
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300"
          >
            {error}
          </div>
        )}

        {data ? (
          <>
            <SummaryCards
              summary={data.summary}
              periodLabel={dateRange.label}
              cardPurchasesFilterActive={cardPurchasesOnly}
              onToggleCardPurchasesFilter={() =>
                handleToggleCardPurchasesOnly(!cardPurchasesOnly)
              }
            />

            <CurrentStatusBar
              accounts={data.accounts}
              thirdPartyPending={data.summary.third_party_pending}
            />

            <AccountsGrid
              accounts={data.accounts}
              selectedAccount={selectedAccount}
              onSelectAccount={handleSelectAccount}
              onSaveInitialBalance={async (id, initial) => {
                await updateAccountInitialBalance(id, initial);
                await loadData(dateRange, statementMonth);
              }}
              onReconcileBalance={async (id, realBalance) => {
                await reconcileAccount(id, realBalance);
                await loadData(dateRange, statementMonth);
              }}
            />

            <CreditCardsSection
              statementMonth={statementMonth}
              onChangeStatementMonth={setStatementMonth}
              statements={data.cardStatements}
              accounts={data.accounts}
              categories={data.categories}
              defaultPayDate={todayStr()}
              selectedAccount={selectedAccount}
              onSelectAccount={handleSelectAccount}
              onPayStatement={async (cardId, payload) => {
                await payCardStatement(cardId, payload);
                await loadData(dateRange, statementMonth);
              }}
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <CategoryChart
                data={data.summary.by_category}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
              />
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
                    await loadData(dateRange, statementMonth);
                  }}
                  onToggleRecurring={async (id, active) => {
                    await updateRecurringItem(id, { active });
                    await loadData(dateRange, statementMonth);
                  }}
                  onDeleteRecurring={async (id) => {
                    await deleteRecurringItem(id);
                    await loadData(dateRange, statementMonth);
                  }}
                />
              </div>
            </div>

            <TransactionList
              transactions={data.transactions}
              accounts={data.accounts}
              categories={data.categories}
              tags={data.tags}
              selectedAccount={selectedAccount}
              onSelectAccount={handleSelectAccount}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
              cardPurchasesOnly={cardPurchasesOnly}
              onToggleCardPurchasesOnly={handleToggleCardPurchasesOnly}
              onEdit={(tx) => {
                setEditingTx(tx);
                setModalOpen(true);
              }}
              onDelete={async (id) => {
                await deleteTransaction(id);
                await loadData(dateRange, statementMonth);
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
            await loadData(dateRange, statementMonth);
            return res.tag;
          }}
          onSubmit={async (payload) => {
            if (payload.id) {
              await updateTransaction(payload.id, payload);
            } else {
              await createTransaction(payload);
            }
            await loadData(dateRange, statementMonth);
          }}
          onSubmitShared={async (payload) => {
            await createSharedPurchase(payload);
            await loadData(dateRange, statementMonth);
          }}
        />
      )}
    </div>
  );
}
export default App;
