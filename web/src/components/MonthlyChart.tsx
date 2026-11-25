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

export function MonthlyChart({ data }: Props) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">Ingresos vs. Gastos (últimos 6 meses)</h3>
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
            <Tooltip
              formatter={(value: number) => formatMoney(value)}
              contentStyle={{
                backgroundColor: '#18181b',
                border: '1px solid #3f3f46',
                borderRadius: '10px',
                color: '#f4f4f5',
                fontSize: '12px',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Bar dataKey="income" name="Ingresos" fill="#10b981" radius={[6, 6, 0, 0]} />
            <Bar dataKey="expense" name="Gastos" fill="#f43f5e" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
