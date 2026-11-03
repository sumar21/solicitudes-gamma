import type { Tono } from "@/components/ui/status-badge";
import { TicketStatus } from "../types";

/**
 * Estados del traslado y su tono en el StatusBadge (DESIGN.md §3.11). Un tono por etapa, con los
 * significados del mapa canónico del kit:
 *   cielo    → todavía no empezó (pre-ticket: falta configurar el destino)
 *   aviso    → pendiente (esperando que la habitación esté lista)
 *   exito    → listo para moverse (habitación lista)
 *   info     → en curso (en traslado)
 *   violeta  → físicamente hecho, falta el cierre (por consolidar ≈ "despachado")
 *   neutro   → cerrado (consolidado)
 *   peligro  → cancelado
 * Azul (~225°) y violeta (~263°) conviven en la grilla: 38° de matiz, se distinguen.
 */
interface InfoEstado {
  label: string;
  tono: Tono;
}

export const ESTADOS_TICKET: Record<TicketStatus, InfoEstado> = {
  [TicketStatus.PRESOLICITUD]: { label: "Presolicitud", tono: "cielo" },
  [TicketStatus.WAITING_ROOM]: { label: "Esperando Habitación", tono: "aviso" },
  [TicketStatus.IN_TRANSIT]: { label: "Habitación Lista", tono: "exito" },
  [TicketStatus.IN_TRANSPORT]: { label: "En Traslado", tono: "info" },
  [TicketStatus.WAITING_CONSOLIDATION]: { label: "Por Consolidar", tono: "violeta" },
  [TicketStatus.COMPLETED]: { label: "Consolidado", tono: "neutro" },
  [TicketStatus.REJECTED]: { label: "Cancelado", tono: "peligro" },
};

/** Label legible de un estado (botonera de filtros de Operativa). */
export const statusLabel = (status: TicketStatus): string => ESTADOS_TICKET[status].label;
export const tonoTicket = (status: TicketStatus): Tono => ESTADOS_TICKET[status].tono;
