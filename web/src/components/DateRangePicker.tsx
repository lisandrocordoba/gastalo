import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';

export type DateFilterMode = 'weeks' | 'months' | 'years' | 'custom';

export interface DateRangeValue {
  mode: DateFilterMode;
  from: string;
  to: string;
  label: string;
}

interface Props {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
}

const MONTH_NAMES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTH_NAMES_FULL = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function getMonthRange(year: number, month1to12: number): DateRangeValue {
  const lastDay = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  const ym = `${year}-${pad2(month1to12)}`;
  const now = new Date();
  const isCurrent = now.getFullYear() === year && now.getMonth() + 1 === month1to12;
  return {
    mode: 'months',
    from: `${ym}-01`,
    to: `${ym}-${pad2(lastDay)}`,
    label: isCurrent ? `Este mes (${MONTH_NAMES_SHORT[month1to12 - 1]} ${year})` : `${MONTH_NAMES_FULL[month1to12 - 1]} ${year}`,
  };
}

export function getWeekRange(anchorIso: string): DateRangeValue {
  const [y, m, d] = anchorIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0=Sun, 1=Mon
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(dt);
  monday.setUTCDate(dt.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const from = toIsoDate(monday);
  const to = toIsoDate(sunday);
  const shortFrom = `${pad2(monday.getUTCDate())}/${pad2(monday.getUTCMonth() + 1)}`;
  const shortTo = `${pad2(sunday.getUTCDate())}/${pad2(sunday.getUTCMonth() + 1)}`;
  return {
    mode: 'weeks',
    from,
    to,
    label: `Sem ${shortFrom} – ${shortTo}`,
  };
}

export function getYearRange(year: number): DateRangeValue {
  return {
    mode: 'years',
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    label: `Año ${year}`,
  };
}

export function getAllTimeRange(): DateRangeValue {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return {
    mode: 'years',
    from: '2022-01-01',
    to: today,
    label: 'Todo el histórico',
  };
}

function shiftRange(val: DateRangeValue, delta: number): DateRangeValue {
  if (val.mode === 'months') {
    const [y, m] = val.from.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return getMonthRange(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }
  if (val.mode === 'weeks') {
    const [y, m, d] = val.from.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + delta * 7));
    return getWeekRange(toIsoDate(dt));
  }
  if (val.mode === 'years' && val.label.startsWith('Año ')) {
    const y = Number(val.from.slice(0, 4)) + delta;
    return getYearRange(y);
  }
  return val;
}

export function DateRangePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DateFilterMode>(value.mode);
  const [pickerYear, setPickerYear] = useState(() => Number(value.from.slice(0, 4)) || new Date().getFullYear());
  const [customFrom, setCustomFrom] = useState(value.from);
  const [customTo, setCustomTo] = useState(value.to);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab(value.mode);
    setPickerYear(Number(value.from.slice(0, 4)) || new Date().getFullYear());
    setCustomFrom(value.from);
    setCustomTo(value.to);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const now = new Date();
  const todayIso = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const currentYm = value.mode === 'months' ? value.from.slice(0, 7) : '';
  const canStep = value.mode !== 'custom' && value.label !== 'Todo el histórico';

  return (
    <div ref={rootRef} className="relative flex items-center gap-1">
      <button
        type="button"
        disabled={!canStep}
        onClick={() => onChange(shiftRange(value, -1))}
        title="Período anterior"
        className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-w-[170px] items-center justify-between gap-2 rounded-xl border border-emerald-500/40 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:border-emerald-400 hover:bg-zinc-800"
      >
        <span className="inline-flex items-center gap-1.5 truncate">
          <Calendar className="h-3.5 w-3.5 text-emerald-400" />
          <span className="truncate">{value.label}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
      </button>

      <button
        type="button"
        disabled={!canStep}
        onClick={() => onChange(shiftRange(value, 1))}
        title="Período siguiente"
        className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 rounded-2xl border border-zinc-700/80 bg-zinc-900 p-3.5 shadow-2xl">
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-zinc-950 p-1 text-[11px] font-medium">
            {([
              { id: 'custom', label: 'Rango' },
              { id: 'weeks', label: 'Semanas' },
              { id: 'months', label: 'Meses' },
              { id: 'years', label: 'Años' },
            ] as const).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-lg py-1.5 transition ${
                  tab === t.id
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'months' && (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between px-2">
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y - 1)}
                  className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-bold text-zinc-100 tabular-nums">{pickerYear}</span>
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y + 1)}
                  className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {MONTH_NAMES_SHORT.map((name, idx) => {
                  const mNum = idx + 1;
                  const ym = `${pickerYear}-${pad2(mNum)}`;
                  const active = currentYm === ym;
                  return (
                    <button
                      key={ym}
                      type="button"
                      onClick={() => {
                        onChange(getMonthRange(pickerYear, mNum));
                        setOpen(false);
                      }}
                      className={`rounded-xl py-2 text-xs font-medium transition ${
                        active
                          ? 'bg-emerald-600 font-semibold text-white'
                          : 'bg-zinc-950/60 text-zinc-300 hover:bg-zinc-800 hover:text-white'
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'weeks' && (
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => {
                  onChange(getWeekRange(todayIso));
                  setOpen(false);
                }}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-xs font-medium text-zinc-200 hover:border-emerald-500/50 hover:bg-zinc-800"
              >
                Esta semana (Lun → Dom)
              </button>
              <button
                type="button"
                onClick={() => {
                  const dt = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 7));
                  onChange(getWeekRange(toIsoDate(dt)));
                  setOpen(false);
                }}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-xs font-medium text-zinc-200 hover:border-emerald-500/50 hover:bg-zinc-800"
              >
                Semana pasada
              </button>
              <button
                type="button"
                onClick={() => {
                  const dt = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 14));
                  onChange(getWeekRange(toIsoDate(dt)));
                  setOpen(false);
                }}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-xs font-medium text-zinc-200 hover:border-emerald-500/50 hover:bg-zinc-800"
              >
                Hace 2 semanas
              </button>
            </div>
          )}

          {tab === 'years' && (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-3 gap-1.5">
                {[2022, 2023, 2024, 2025, 2026].map((y) => {
                  const active = value.mode === 'years' && value.label === `Año ${y}`;
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => {
                        onChange(getYearRange(y));
                        setOpen(false);
                      }}
                      className={`rounded-xl py-2 text-xs font-semibold tabular-nums transition ${
                        active
                          ? 'bg-emerald-600 text-white'
                          : 'bg-zinc-950/70 text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  onChange(getAllTimeRange());
                  setOpen(false);
                }}
                className={`w-full rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                  value.label === 'Todo el histórico'
                    ? 'border-emerald-500 bg-emerald-600 text-white'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-800'
                }`}
              >
                Todo el histórico (2022 → hoy)
              </button>
            </div>
          )}

          {tab === 'custom' && (
            <div className="mt-3 space-y-2.5">
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">Desde</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">Hasta</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500"
                />
              </div>
              <button
                type="button"
                disabled={!customFrom || !customTo || customFrom > customTo}
                onClick={() => {
                  onChange({
                    mode: 'custom',
                    from: customFrom,
                    to: customTo,
                    label: `${customFrom} → ${customTo}`,
                  });
                  setOpen(false);
                }}
                className="w-full rounded-xl bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                Aplicar rango
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
