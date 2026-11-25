import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatMoney } from '../api';
import type { CategoryBreakdown } from '../types';

interface Props {
  data: CategoryBreakdown[];
}

export function CategoryChart({ data }: Props) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">Gastos por categoría</h3>
      {data.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
          Sin gastos registrados este mes.
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="total"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={84}
                  paddingAngle={2}
                >
                  {data.map((entry) => (
                    <Cell key={entry.category_id} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
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
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {data.slice(0, 7).map((item) => (
              <div key={item.category_id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 truncate">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="truncate text-zinc-300">
                    {item.icon} {item.name}
                  </span>
                </div>
                <div className="ml-2 shrink-0 text-right">
                  <span className="font-medium text-zinc-100">{formatMoney(item.total)}</span>
                  <span className="ml-1.5 text-zinc-500">{item.percentage}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
