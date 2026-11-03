import type { Tono } from "@/components/ui/status-badge";
import { TicketStatus } from "../types";

/**
 * Estados del traslado y su tono en el StatusBadge (BASE §4, DESIGN §1.1).
 * Un tono por etapa del circuito, no uno por estado: los distingue el texto.
 *   neutro  → todavía no es un traslado (pre-ticket)
 *   aviso   → falta que otro haga algo (habitación, consolidar)
 *   info    → en curso (habitación lista, en traslado)
 *   exito / peligro → terminado bien / cancelado
 * La marca no va en estados (BASE §3).
 */
interface InfoEstado {
  label: string;
  tono: Tono;
}

export const ESTADOS_TICKET: Record<TicketStatus, InfoEstado> = {
  [TicketStatus.PRESOLICITUD]: { label: "Presolicitud", tono: "neutro" },
  [TicketStatus.WAITING_ROOM]: { label: "Esperando Habitación", tono: "aviso" },
  [TicketStatus.IN_TRANSIT]: { label: "Habitación Lista", tono: "info" },
  [TicketStatus.IN_TRANSPORT]: { label: "En Traslado", tono: "info" },
  [TicketStatus.WAITING_CONSOLIDATION]: { label: "Por Consolidar", tono: "aviso" },
  [TicketStatus.COMPLETED]: { label: "Consolidado", tono: "exito" },
  [TicketStatus.REJECTED]: { label: "Cancelado", tono: "peligro" },
};

/** Label legible de un estado (botonera de filtros de Operativa). */
export const statusLabel = (status: TicketStatus): string => ESTADOS_TICKET[status].label;
export const tonoTicket = (status: TicketStatus): Tono => ESTADOS_TICKET[status].tono;
