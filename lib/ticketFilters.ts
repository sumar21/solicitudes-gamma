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
export function visibleStatusChips(opts: {
  filterByFloors: boolean;
  canSeePreTickets: boolean;
  /**
   * Quien puede crear (pre-)tickets (`crear_pre_ticket` / `crear_ticket`) NO se recorta por estado aunque filtre
   * por pisos (RequestsView): ve todos los estados de sus sectores, incluidos Presolicitud y Por Consolidar.
   */
  canCreateTickets?: boolean;
  /** Admin/Admisión en la pestaña "Azafata": ve solo los estados operativos (sin cancelados: esos son de quien filtra por pisos). */
  actingAsHostess?: boolean;
}): TicketStatus[] {
  if (opts.actingAsHostess) {
    return [TicketStatus.WAITING_ROOM, TicketStatus.IN_TRANSIT, TicketStatus.IN_TRANSPORT];
  }
  if (opts.filterByFloors) {
    // Azafata / Catering (filtran por pisos): estados operativos + cancelados recientes (< 1h).
    if (!opts.canCreateTickets) {
      return [TicketStatus.WAITING_ROOM, TicketStatus.IN_TRANSIT, TicketStatus.IN_TRANSPORT, TicketStatus.REJECTED];
    }
    // Coordinación (filtra por pisos pero crea tickets): el ciclo completo de sus sectores + cancelados recientes.
    return [
      ...(opts.canSeePreTickets ? [TicketStatus.PRESOLICITUD] : []),
      TicketStatus.WAITING_ROOM, TicketStatus.IN_TRANSIT, TicketStatus.IN_TRANSPORT, TicketStatus.WAITING_CONSOLIDATION,
      TicketStatus.REJECTED,
    ];
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

/**
 * Chip "Urgencias" (pedido de Gamma, 06/10/2026). La urgencia no es un estado sino un flag del ticket (nace
 * "Por Consolidar"), así que va como chip aparte y se COMBINA con los de estado (Y lógico): prendido solo,
 * muestra todas las urgencias; con "Por Consolidar" también prendido, las urgencias por consolidar.
 * Se ofrece sólo a quien ve "Por Consolidar" (una azafata nunca ve urgencias → sería un chip que da cero).
 */
export function showUrgenciasChip(statuses: readonly TicketStatus[]): boolean {
  return statuses.includes(TicketStatus.WAITING_CONSOLIDATION);
}

export function applyUrgenciaFilter<T extends { urgencia?: boolean }>(tickets: readonly T[], onlyUrgencias: boolean): T[] {
  return onlyUrgencias ? tickets.filter(t => t.urgencia === true) : [...tickets];
}

/** Prende/apaga un estado (multi-selección). Devuelve un Set NUEVO (inmutable para React). */
export function toggleStatus(selected: ReadonlySet<TicketStatus>, status: TicketStatus): Set<TicketStatus> {
  const next = new Set(selected);
  if (next.has(status)) next.delete(status); else next.add(status);
  return next;
}
