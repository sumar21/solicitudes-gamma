import React, { useState } from 'react';
import { TicketStatus } from '../types';
import { Filter, ChevronDown, X } from './Icons';
import { Siren } from 'lucide-react';
import { statusLabel, tonoTicket } from '../lib/estados';
import { PUNTO_TONO } from './ui/status-badge';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

/**
 * Botonera de estados de la grilla de Operativa: un chip por estado (con su contador) que filtra la
 * grilla. Multi-selección; sin nada elegido se ve todo. Qué chips se ofrecen lo decide el padre según el
 * rol (ver lib/ticketFilters.visibleStatusChips).
 *
 * Mobile: un chip por estado ocupa mucho y taparía la lista, así que ahí colapsa detrás de un botón
 * "Filtros" (con la cantidad de estados activos) y se despliega al tocarlo. En desktop va siempre visible.
 */
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

  // Chip de filtro rápido: el punto lleva el tono del estado (lib/estados.ts); elegido = primary, como
  // toda selección del Estilo 1 (DESIGN §1.1).
  const chipBase = 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border pr-2 pl-2.5 text-xs font-medium transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring md:h-8';
  const chipOff = 'bg-card text-foreground hover:bg-accent';
  const chipOn = 'border-primary bg-primary text-primary-foreground';
  const contador = (on: boolean, n: number) => cn(
    'rounded-full px-1.5 text-[10px] tabular-nums',
    on ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground',
    n === 0 && !on && 'opacity-60',
  );

  return (
    <div className="space-y-2" data-testid="ticket-status-filter">
      {/* Mobile: botón de filtro */}
      <div className="flex items-center gap-2 md:hidden">
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-controls="ticket-status-chips"
          onClick={() => setOpen(o => !o)}
          className={cn('gap-2 px-3', active > 0 && 'border-primary/40 bg-primary/5')}
        >
          <Filter className="size-4" />
          Filtrar
          {active > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">
              {active}
            </span>
          )}
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </Button>
        {active > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
            <X /> Limpiar
          </Button>
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
          className={cn(chipBase, active === 0 ? chipOn : chipOff)}
        >
          Todos
          <span className={contador(active === 0, total)}>{total}</span>
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
              className={cn(chipBase, on ? chipOn : chipOff)}
            >
              <span className={cn('size-2 shrink-0 rounded-full', PUNTO_TONO[tonoTicket(s)], on && 'ring-2 ring-primary-foreground/60')} aria-hidden="true" />
              {statusLabel(s)}
              <span className={contador(on, n)}>{n}</span>
            </button>
          );
        })}
        {urgencias && (
          <button
            type="button"
            aria-pressed={urgencias.on}
            onClick={urgencias.onToggle}
            title="Urgencias / ingresos directos (se combina con los estados)"
            className={cn(chipBase, urgencias.on ? chipOn : chipOff)}
          >
            <Siren className={cn('size-3 shrink-0', !urgencias.on && 'text-destructive')} strokeWidth={2.5} aria-hidden="true" />
            Urgencias
            <span className={contador(urgencias.on, urgencias.count)}>{urgencias.count}</span>
          </button>
        )}
        {active > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear} className="hidden h-8 text-xs text-muted-foreground md:inline-flex">
            <X /> Limpiar
          </Button>
        )}
      </div>
    </div>
  );
};
