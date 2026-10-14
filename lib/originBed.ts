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
 *   - marca como huérfanos los tickets cuyo paciente ya no está en su cama de origen.
 * Puro (sin React ni red). Self-check: npx tsx scripts/check-origin-bed.mts
 */
import { Bed, BedStatus, Ticket, TicketStatus } from '../types';
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
