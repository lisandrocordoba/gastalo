import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatMoney } from '../api';
import type { CategoryBreakdown } from '../types';

interface Props {
  data: CategoryBreakdown[];
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: CategoryBreakdown }>;
}

function CustomCategoryTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-100">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: item.color }}
        />
        <span>
          {item.icon} {item.name}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2 tabular-nums">
        <span className="text-sm font-bold text-white">{formatMoney(item.total)}</span>
        <span className="text-[11px] text-zinc-400">{item.percentage}%</span>
      </div>
    </div>
  );
}

export function CategoryChart({ data, selectedCategory, onSelectCategory }: Props) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-200">Gastos por categoría</h3>
        {selectedCategory && (
          <button
            type="button"
            onClick={() => onSelectCategory('')}
            className="text-xs text-emerald-400 hover:underline"
          >
            Limpiar filtro
          </button>
        )}
      </div>
      {data.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
          Sin gastos registrados en este período.
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
                  innerRadius={54}
                  outerRadius={86}
                  paddingAngle={2}
                  className="cursor-pointer"
                  onClick={(entry) => {
                    const catId =
                      (entry as CategoryBreakdown & { payload?: CategoryBreakdown })?.category_id ??
                      (entry as { payload?: CategoryBreakdown })?.payload?.category_id;
                    if (catId) {
                      onSelectCategory(selectedCategory === catId ? '' : catId);
                    }
                  }}
                >
                  {data.map((entry) => {
                    const active = !selectedCategory || selectedCategory === entry.category_id;
                    return (
                      <Cell
                        key={entry.category_id}
                        fill={entry.color}
                        fillOpacity={active ? 1 : 0.3}
                        stroke={selectedCategory === entry.category_id ? '#34d399' : 'transparent'}
                        strokeWidth={selectedCategory === entry.category_id ? 2 : 0}
                      />
                    );
                  })}
                </Pie>
                <Tooltip content={<CustomCategoryTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {data.map((item) => {
              const active = selectedCategory === item.category_id;
              return (
                <button
                  key={item.category_id}
                  type="button"
                  onClick={() => onSelectCategory(active ? '' : item.category_id)}
                  className={`flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left text-xs transition ${
                    active ? 'bg-zinc-800 ring-1 ring-emerald-500/60' : 'hover:bg-zinc-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate text-zinc-200">
                      {item.icon} {item.name}
                    </span>
                  </div>
                  <div className="ml-2 shrink-0 text-right tabular-nums">
                    <span className="font-medium text-zinc-100">{formatMoney(item.total)}</span>
                    <span className="ml-1.5 text-zinc-500">{item.percentage}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
