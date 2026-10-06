import React, { useState } from 'react';
import { TicketStatus } from '../types';
import { Filter, ChevronDown, X } from './Icons';
import { Siren } from 'lucide-react';
import { statusLabel } from './StatusBadge';
import { cn } from '../lib/utils';

/**
 * Botonera de estados de la grilla de Operativa: un chip por estado (con su contador) que filtra la
 * grilla. Multi-selección; sin nada elegido se ve todo. Qué chips se ofrecen lo decide el padre según el
 * rol (ver lib/ticketFilters.visibleStatusChips).
 *
 * Mobile: un chip por estado ocupa mucho y taparía la lista, así que ahí colapsa detrás de un botón
 * "Filtros" (con la cantidad de estados activos) y se despliega al tocarlo. En desktop va siempre visible.
 */
const STYLE: Record<TicketStatus, { dot: string; on: string }> = {
  [TicketStatus.PRESOLICITUD]:           { dot: 'bg-fuchsia-500', on: 'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-800' },
  [TicketStatus.WAITING_ROOM]:           { dot: 'bg-amber-500',   on: 'bg-amber-100 border-amber-300 text-amber-800' },
  [TicketStatus.IN_TRANSIT]:             { dot: 'bg-blue-500',    on: 'bg-blue-100 border-blue-300 text-blue-800' },
  [TicketStatus.IN_TRANSPORT]:           { dot: 'bg-slate-500',   on: 'bg-slate-200 border-slate-400 text-slate-800' },
  [TicketStatus.WAITING_CONSOLIDATION]:  { dot: 'bg-purple-500',  on: 'bg-purple-100 border-purple-300 text-purple-800' },
  [TicketStatus.COMPLETED]:              { dot: 'bg-emerald-500', on: 'bg-emerald-100 border-emerald-300 text-emerald-800' },
  [TicketStatus.REJECTED]:               { dot: 'bg-red-500',     on: 'bg-red-100 border-red-300 text-red-800' },
};

interface Props {
  statuses: TicketStatus[];
  counts: Partial<Record<TicketStatus, number>>;
  /** Total de la grilla SIN filtro de estado (lo que muestra "Todos"). */
  total: number;
  selected: ReadonlySet<TicketStatus>;
  onToggle: (status: TicketStatus) => void;
  onClear: () => void;
  /** Chip "Urgencias" (flag, no estado): se combina con los de estado. Sin esto no se muestra. */
  urgencias?: { count: number; on: boolean; onToggle: () => void };
}

export const TicketStatusFilter: React.FC<Props> = ({ statuses, counts, total, selected, onToggle, onClear, urgencias }) => {
  const [open, setOpen] = useState(false); // sólo afecta a mobile
  const active = selected.size + (urgencias?.on ? 1 : 0);

  const chipBase = 'inline-flex items-center gap-1.5 h-9 md:h-8 pl-2.5 pr-2 rounded-full border text-[11px] font-bold transition-colors whitespace-nowrap';
  const chipOff = 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50';

  return (
    <div className="space-y-2" data-testid="ticket-status-filter">
      {/* Mobile: botón de filtro */}
      <div className="flex items-center gap-2 md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="ticket-status-chips"
          onClick={() => setOpen(o => !o)}
          className={cn(
            'inline-flex items-center gap-2 h-10 px-3 rounded-xl border text-xs font-bold transition-colors',
            active > 0 ? 'bg-emerald-950 border-emerald-950 text-white' : 'bg-white border-slate-200 text-slate-700',
          )}
        >
          <Filter className="w-3.5 h-3.5" />
          Filtrar
          {active > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-white text-emerald-950 text-[10px] font-black flex items-center justify-center tabular-nums">
              {active}
            </span>
          )}
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
        </button>
        {active > 0 && (
          <button type="button" onClick={onClear} className="inline-flex items-center gap-1 h-10 px-2 text-xs font-bold text-slate-500">
            <X className="w-3.5 h-3.5" /> Limpiar
          </button>
        )}
      </div>

      {/* Chips: siempre en desktop; en mobile sólo desplegados */}
      <div
        id="ticket-status-chips"
        className={cn('flex-wrap items-center gap-2', open ? 'flex' : 'hidden', 'md:flex')}
      >
        <button
          type="button"
          aria-pressed={active === 0}
          onClick={onClear}
          className={cn(chipBase, active === 0 ? 'bg-emerald-950 border-emerald-950 text-white' : chipOff)}
        >
          Todos
          <span className={cn('tabular-nums rounded-full px-1.5 text-[10px]', active === 0 ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>{total}</span>
        </button>
        {statuses.map(s => {
          const on = selected.has(s);
          const n = counts[s] ?? 0;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(s)}
              className={cn(chipBase, on ? STYLE[s].on : chipOff)}
            >
              <span className={cn('w-2 h-2 rounded-full shrink-0', STYLE[s].dot)} />
              {statusLabel(s)}
              <span className={cn('tabular-nums rounded-full px-1.5 text-[10px]', on ? 'bg-white/70' : 'bg-slate-100 text-slate-500', n === 0 && 'opacity-50')}>{n}</span>
            </button>
          );
        })}
        {urgencias && (
          <button
            type="button"
            aria-pressed={urgencias.on}
            onClick={urgencias.onToggle}
            title="Urgencias / ingresos directos (se combina con los estados)"
            className={cn(chipBase, urgencias.on ? 'bg-red-100 border-red-300 text-red-800' : chipOff)}
          >
            <Siren className="w-3 h-3 text-red-600 shrink-0" strokeWidth={2.5} />
            Urgencias
            <span className={cn('tabular-nums rounded-full px-1.5 text-[10px]', urgencias.on ? 'bg-white/70' : 'bg-slate-100 text-slate-500', urgencias.count === 0 && 'opacity-50')}>{urgencias.count}</span>
          </button>
        )}
        {active > 0 && (
          <button type="button" onClick={onClear} className="hidden md:inline-flex items-center gap-1 h-8 px-2 text-[11px] font-bold text-slate-500 hover:text-slate-700">
            <X className="w-3 h-3" /> Limpiar filtro
          </button>
        )}
      </div>
    </div>
  );
};
