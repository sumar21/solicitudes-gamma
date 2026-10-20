/**
 * Regla "un solo traslado/pre-ticket activo por cama de origen" + tickets huérfanos.
 *
 * El bloqueo compara la ETIQUETA de la cama, no el paciente, y se valida solo en el cliente. Si un
 * paciente deja la cama por PROGAL sin pasar por MediFlow, su pre-ticket/traslado sigue activo y traba
 * al nuevo ocupante de esa cama (caso real 14/10/2026 en ITR Cama 03). Este módulo:
 *   - encuentra el ticket que bloquea una cama de origen,
 *   - dice si es del paciente que HOY está en la cama o de otro, y dónde está ese paciente ahora
 *     (caso típico: lo pasaron de una cama de ITR a otra por PROGAL y el ticket quedó en la vieja),
 *   - arma el aviso (el mismo texto en los modales, en el appAlert del hook y en Operativa),
 *   - marca como huérfanos los tickets cuyo paciente ya no está en su cama de origen,
 *   - detecta los que PROGAL ya cambió de cama, para reubicar su origen solo (findOriginMoves),
 *   - dice si un pre-ticket configurado puede volver a "Presolicitud" (puedeRestablecerDestino).
 * Puro (sin React ni red). Self-check: npx tsx scripts/check-origin-bed.mts
 */
import { Bed, BedStatus, Ticket, TicketStatus, WorkflowType } from '../types';
import { formatBedName, formatDateTime } from './utils';

export const isActiveTicket = (t: Ticket): boolean =>
  t.status !== TicketStatus.COMPLETED && t.status !== TicketStatus.REJECTED;

/** Cama de origen → el ticket activo que sale de ella (el que bloquea cargar otro). */
export function activeTicketsByOrigin(tickets: Ticket[]): Map<string, Ticket> {
  const m = new Map<string, Ticket>();
  for (const t of tickets) if (t.origin && isActiveTicket(t) && !m.has(t.origin)) m.set(t.origin, t);
  return m;
}

/** ¿La cama tiene HOY al paciente del ticket? Por código de paciente si están los dos; si falta alguno, por nombre. */
export function bedHasTicketPatient(bed: Bed, ticket: Ticket): boolean {
  if (bed.status !== BedStatus.OCCUPIED) return false;
  const bp = String(bed.patientCode ?? '').trim();
  const tp = String(ticket.patientCode ?? '').trim();
  if (bp && tp) return bp === tp;
  const bn = (bed.patientName ?? '').trim().toLowerCase();
  const tn = (ticket.patientName ?? '').trim().toLowerCase();
  return !!bn && bn === tn;
}

/** La cama está ocupada por OTRO paciente que el del ticket (dos pacientes no comparten cama). */
export function bedHasOtherPatient(bed: Bed | undefined, ticket: Ticket): boolean {
  return !!bed && bed.status === BedStatus.OCCUPIED && !!(bed.patientName || bed.patientCode)
    && !bedHasTicketPatient(bed, ticket);
}

/** La cama donde está HOY el paciente del ticket (ocupada con su código), fuera de su cama de origen. */
export function findPatientBed(beds: Bed[], ticket: Ticket): Bed | undefined {
  const tp = String(ticket.patientCode ?? '').trim();
  if (!tp) return undefined; // sin código no se lo busca por nombre (homónimos)
  return beds.find(b => b.label !== ticket.origin && b.status === BedStatus.OCCUPIED
    && String(b.patientCode ?? '').trim() === tp);
}

// Estados en los que el paciente todavía no salió de la cama de origen. En Traslado / Por Consolidar
// ya salió: que PROGAL muestre a otro en esa cama es normal hasta que se consolide.
const STILL_ON_ORIGIN = new Set<TicketStatus>([
  TicketStatus.PRESOLICITUD, TicketStatus.WAITING_ROOM, TicketStatus.IN_TRANSIT,
]);

export interface OrphanTicket {
  /** Quién ocupa hoy la cama de origen según PROGAL. */
  occupantName?: string;
  /** Dónde está hoy el paciente del ticket (label de cama), si figura en el mapa. */
  patientNowAt?: string;
  /** El paciente tiene código y no figura en ninguna cama del mapa (alta, o se fue). */
  patientNotInMap?: boolean;
}

/**
 * Tickets huérfanos: todavía no salieron (Presolicitud / Esperando Habitación / Habitación Lista) pero
 * PROGAL ya tiene a OTRO paciente en su cama de origen. Solo cuenta un ocupante distinto: una cama vacía
 * no alcanza, porque el sillón de Sala de Espera o un PROGAL adelantado la muestran libre con el
 * paciente todavía ahí (por eso mergeBeds hace keepPatientOnOrigin).
 * `rawBeds` = camas CRUDAS de Gamma, sin los overlays de tickets de mergeBeds.
 */
export function findOrphanTickets(tickets: Ticket[], rawBeds: Bed[]): Map<string, OrphanTicket> {
  const out = new Map<string, OrphanTicket>();
  if (!rawBeds.length) return out; // mapa sin cargar: no sabemos nada
  const byLabel = new Map(rawBeds.map(b => [b.label, b]));
  for (const t of tickets) {
    if (!STILL_ON_ORIGIN.has(t.status)) continue;
    const bed = byLabel.get(t.origin);
    if (!bed || !bedHasOtherPatient(bed, t)) continue;
    const now = findPatientBed(rawBeds, t);
    out.set(t.id, { occupantName: bed.patientName, patientNowAt: now?.label, patientNotInMap: !now && !!t.patientCode });
  }
  return out;
}

export interface OriginMove {
  ticketId: string;
  from: string;
  to: string;
  toCode?: string;
  toArea?: string;
  patientCode: string;
}

/**
 * Origen automático (20/10/2026): pedidos que todavía no salieron cuyo paciente PROGAL ya ubica en OTRA
 * cama (p. ej. lo pasaron de la 407.1 a la 407.2). El pedido se reubica a la cama nueva para que la vieja
 * quede libre para otro paciente. Conservador, porque escribe solo:
 *   - solo con código de paciente (sin código no se lo busca por nombre: homónimos);
 *   - la cama vieja está en el mapa y NO tiene al paciente (si figura en las dos, PROGAL está a mitad);
 *   - el paciente figura en UNA sola cama nueva, y no es el destino del pedido (PROGAL adelantado: ya lo
 *     consolidaron allá y el paciente sigue en la de origen hasta que lo trasladen);
 *   - ningún otro pedido activo sale de la cama nueva.
 * `rawBeds` = camas CRUDAS de Gamma. Del lado del servidor, validarReubicarOrigen (api/ticket-origen.ts).
 */
export function findOriginMoves(tickets: Ticket[], rawBeds: Bed[]): OriginMove[] {
  const out: OriginMove[] = [];
  if (!rawBeds.length) return out;
  const byLabel = new Map(rawBeds.map(b => [b.label, b]));
  const byOrigin = activeTicketsByOrigin(tickets);
  for (const t of tickets) {
    const pc = String(t.patientCode ?? '').trim();
    if (!STILL_ON_ORIGIN.has(t.status) || !pc || t.urgencia) continue;
    const old = byLabel.get(t.origin);
    if (!old || bedHasTicketPatient(old, t)) continue;
    const nuevas = rawBeds.filter(b => b.label !== t.origin && b.status === BedStatus.OCCUPIED
      && String(b.patientCode ?? '').trim() === pc);
    if (nuevas.length !== 1) continue;
    const now = nuevas[0];
    if (now.label === t.destination) continue;
    const otro = byOrigin.get(now.label);
    if (otro && otro.id !== t.id) continue;
    out.push({ ticketId: t.id, from: t.origin, to: now.label, toCode: now.bedCode, toArea: now.area, patientCode: pc });
  }
  return out;
}

/**
 * "Restablecer destino": un pre-ticket CONFIGURADO (con cama destino, todavía sin intervención de la
 * azafata) puede volver a "Presolicitud" y liberar la cama. Espeja validarRestablecerDestino
 * (api/ticket-origen.ts), que es la regla real.
 */
export function puedeRestablecerDestino(t: Ticket): boolean {
  return t.workflow === WorkflowType.PRE_TICKET && !t.urgencia && !!t.destination
    && (t.status === TicketStatus.WAITING_ROOM || t.status === TicketStatus.IN_TRANSIT)
    && t.intervenedByHostess !== 'SI' && t.canCancel !== false;
}

export interface OriginBedBusy {
  title: string;
  message: string;
  /** El ticket que bloquea es de otro paciente que el que hoy ocupa la cama. */
  otherPatient: boolean;
}

/**
 * Aviso del bloqueo: nombra al paciente y el TSL del ticket que bloquea, dónde está ese paciente hoy y
 * qué hacer. `beds` = el mapa de camas actual (de ahí salen el ocupante de la cama y la cama del paciente).
 */
export function describeOriginBedBusy(existing: Ticket, beds: Bed[]): OriginBedBusy {
  const occupant = beds.find(b => b.label === existing.origin);
  const tipo = existing.status === TicketStatus.PRESOLICITUD ? 'pre-ticket' : 'traslado';
  const ref = `${existing.id}, cargado el ${formatDateTime(existing.createdAt)}`;
  if (!bedHasOtherPatient(occupant, existing)) {
    return {
      otherPatient: false,
      title: `Ya hay un ${tipo} activo para esta cama`,
      message: `${existing.patientName} ya tiene un ${tipo} activo desde esta cama (${ref}). Completalo o cancelalo desde Operativa antes de cargar otro.`,
    };
  }
  if (STILL_ON_ORIGIN.has(existing.status)) {
    const title = `La cama tiene un ${tipo} de otro paciente`;
    const marca = '(figura como "Ya no está en la cama")';
    const now = findPatientBed(beds, existing);
    if (now) {
      // Lo cambiaron de cama por PROGAL: el pedido sigue valiendo, pero quedó apuntando a la cama vieja.
      return {
        otherPatient: true, title,
        message: `Esta cama tiene un ${tipo} activo de ${existing.patientName} (${ref}), que hoy está en ${formatBedName(now.label)}: el ${tipo} quedó apuntando a la cama anterior. Cancelalo desde Operativa ${marca}, volvé a cargarlo desde la cama nueva y después cargá este.`,
      };
    }
    return {
      otherPatient: true, title,
      message: `Esta cama tiene un ${tipo} activo de ${existing.patientName} (${ref}), que ya no figura ${existing.patientCode ? 'en ninguna cama del mapa' : 'en la cama'}. Si se fue sin pasar por MediFlow, cancelá ese ${tipo} desde Operativa ${marca} y volvé a cargar este.`,
    };
  }
  // En Traslado / Por Consolidar: el paciente anterior ya salió; falta cerrar su traslado.
  return {
    otherPatient: true,
    title: 'La cama tiene un traslado sin cerrar',
    message: `El traslado de ${existing.patientName} (${ref}) todavía figura saliendo de esta cama ("${existing.status}"). Cuando se consolide, la cama queda libre para cargar este.`,
  };
}
