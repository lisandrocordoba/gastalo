import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '../api';
import type { MonthlyHistoryPoint } from '../types';

interface Props {
  data: MonthlyHistoryPoint[];
}

interface CustomTooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
  }>;
}

function CustomMonthlyTooltip({ active, label, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="mb-1 text-xs font-semibold text-zinc-200 tabular-nums">{label}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div
            key={entry.name}
            className="flex items-center justify-between gap-4 text-xs tabular-nums"
          >
            <span className="flex items-center gap-1.5 text-zinc-300">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color ?? '#f4f4f5' }}
              />
              {entry.name}
            </span>
            <span className="font-semibold text-white">
              {formatMoney(Number(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonthlyChart({ data }: Props) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">
        Ingresos vs. Gastos ({data.length} {data.length === 1 ? 'mes' : 'meses'})
      </h3>
      <div className="mt-3 h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="month" stroke="#a1a1aa" fontSize={11} tickLine={false} />
            <YAxis
              stroke="#a1a1aa"
              fontSize={11}
              tickLine={false}
              tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
            />
            <Tooltip cursor={{ fill: '#27272a', opacity: 0.35 }} content={<CustomMonthlyTooltip />} />
            <Legend wrapperStyle={{ fontSize: '12px', color: '#e4e4e7' }} />
            <Bar dataKey="income" name="Ingresos" fill="#FBC02D" radius={[6, 6, 0, 0]} />
            <Bar dataKey="expense" name="Gastos" fill="#F44336" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
