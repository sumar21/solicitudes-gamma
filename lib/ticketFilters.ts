/**
 * Filtro por ESTADO de la grilla de Operativa (botonera de chips).
 *
 * Lógica pura (sin React) para poder testearla contra la función real. La grilla ya recorta lo que
 * cada rol puede ver (pre-tickets sólo para Coordinación/Admisión, y quien filtra por pisos —azafata—
 * sólo ve los estados operativos); la botonera tiene que ofrecer EXACTAMENTE los estados que ese
 * usuario puede llegar a ver, ni uno más: un chip de "Por Consolidar" para una azafata sería un
 * botón que siempre da cero. Si cambia la regla de visibilidad de RequestsView, cambia acá.
 */
import { TicketStatus } from '../types';

/** Orden de los chips = orden del ciclo de vida del traslado. */
export function visibleStatusChips(opts: { filterByFloors: boolean; canSeePreTickets: boolean }): TicketStatus[] {
  if (opts.filterByFloors) {
    // Azafata / Catering (filtran por pisos): estados operativos + cancelados recientes (< 1h).
    return [TicketStatus.WAITING_ROOM, TicketStatus.IN_TRANSIT, TicketStatus.IN_TRANSPORT, TicketStatus.REJECTED];
  }
  const base = [
    TicketStatus.WAITING_ROOM, TicketStatus.IN_TRANSIT, TicketStatus.IN_TRANSPORT, TicketStatus.WAITING_CONSOLIDATION,
  ];
  return opts.canSeePreTickets ? [TicketStatus.PRESOLICITUD, ...base] : base;
}

export function countByStatus(tickets: readonly { status: TicketStatus }[]): Partial<Record<TicketStatus, number>> {
  const out: Partial<Record<TicketStatus, number>> = {};
  for (const t of tickets) out[t.status] = (out[t.status] ?? 0) + 1;
  return out;
}

/** Selección vacía = sin filtro (se ve todo). Con selección, sólo esos estados. */
export function applyStatusFilter<T extends { status: TicketStatus }>(
  tickets: readonly T[],
  selected: ReadonlySet<TicketStatus>,
): T[] {
  return selected.size === 0 ? [...tickets] : tickets.filter(t => selected.has(t.status));
}

/** Prende/apaga un estado (multi-selección). Devuelve un Set NUEVO (inmutable para React). */
export function toggleStatus(selected: ReadonlySet<TicketStatus>, status: TicketStatus): Set<TicketStatus> {
  const next = new Set(selected);
  if (next.has(status)) next.delete(status); else next.add(status);
  return next;
}
