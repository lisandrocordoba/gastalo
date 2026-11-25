import { Hash, Users } from 'lucide-react';
import { formatMoney } from '../api';
import type { TagBreakdown, ThirdPartyBalance } from '../types';

interface Props {
  byTag: TagBreakdown[];
  thirdPartyByPerson: ThirdPartyBalance[];
  selectedTagId: string;
  onSelectTag: (tagId: string) => void;
}

export function TagsPanel({
  byTag,
  thirdPartyByPerson,
  selectedTagId,
  onSelectTag,
}: Props) {
  return (
    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-zinc-200">Gastos por etiqueta</h3>
          </div>
          {selectedTagId && (
            <button
              type="button"
              onClick={() => onSelectTag('')}
              className="text-xs text-emerald-400 hover:underline"
            >
              Limpiar filtro
            </button>
          )}
        </div>

        {byTag.length === 0 ? (
          <p className="mt-4 text-xs text-zinc-500">
            Sin gastos etiquetados este mes (ej. #casa, #hormiga, #abril).
          </p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {byTag.map((item) => {
              const active = selectedTagId === item.tag_id;
              return (
                <button
                  key={item.tag_id}
                  type="button"
                  onClick={() => onSelectTag(active ? '' : item.tag_id)}
                  className={`block w-full rounded-xl p-2 text-left transition ${
                    active ? 'bg-zinc-800 ring-1 ring-emerald-500/60' : 'hover:bg-zinc-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-200">#{item.name}</span>
                    <span className="text-zinc-300">
                      {formatMoney(item.total)}{' '}
                      <span className="text-zinc-500">({item.percentage}%)</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(4, item.percentage))}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {thirdPartyByPerson.length > 0 && (
        <div className="border-t border-zinc-800 pt-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-sky-400" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Pendiente de terceros (te deben)
            </h4>
          </div>
          <div className="mt-2 space-y-1.5">
            {thirdPartyByPerson.map((p) => (
              <div key={p.person} className="flex items-center justify-between text-xs">
                <span className="text-zinc-300">{p.person}</span>
                <span className="font-semibold text-sky-400">{formatMoney(p.pending)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
