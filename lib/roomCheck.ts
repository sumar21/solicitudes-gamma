/**
 * "Solicitar limpieza OK": cuándo un traslado NO puede pasar directo a "Habitación Lista".
 *
 * Una cama en verde (Disponible) en PROGAL no garantiza que la habitación esté armada y limpia al
 * 100%. Pasa sobre todo en habitaciones COMPARTIDAS cuando la otra cama está ocupada: la familia o
 * las visitas del paciente que ya está se sientan o se acuestan en la cama libre, así que el
 * hospital la deja a medias (sólo el cubrecama) y la termina de armar cuando llega el pedido. Lo
 * mismo con los requerimientos especiales (colchón, intento de autólisis…): la habitación puede
 * estar "libre" pero sin el armado que pide ese paciente.
 *
 * Si el traslado saliera como "Habitación Lista" apenas Admisión elige la cama, Coordinación
 * mandaría al paciente a una habitación que la azafata todavía está armando. Por eso, en esos casos
 * el traslado queda en "Esperando Habitación" aunque la cama esté Disponible, y la azafata lo
 * libera con "Habitación Lista" (viendo los requerimientos y el aviso de habitación compartida).
 *
 * Todo acá es PURO (sin React ni red) para poder testearlo contra la función real.
 */
import { Bed, BedStatus, TicketStatus } from '../types';
import { isIndividualBoxArea } from './utils';
import { REQUISITO_SIN } from './constants';

export interface RoomCheck {
  /** ¿Hay que pedir confirmación de la azafata antes de liberar el traslado? */
  required: boolean;
  /** La habitación destino es compartida y la cama contigua está ocupada. */
  shared: boolean;
  /** Camas contiguas ocupadas (vacío si no es compartida). */
  neighbors: Bed[];
  /** Requerimientos reales del pedido ("Sin requerimiento" y vacíos no cuentan). */
  requisitos: string[];
}

/** Requerimientos que obligan a armar algo: descarta vacíos y la opción "Sin requerimiento". */
export function realRequisitos(requisitos?: readonly string[] | null): string[] {
  return (requisitos ?? []).map(r => String(r ?? '').trim()).filter(r => r && r !== REQUISITO_SIN);
}

/**
 * Camas OCUPADAS de la misma habitación que el destino (excluida la propia cama destino y la cama
 * de origen del traslado: un cambio de cama dentro del mismo cuarto no tiene "vecino" que moleste).
 * Habitación = mismo `roomCode` + misma `area` (mismo criterio que `roomSexConflict`).
 *
 * Ocupante = `status === OCCUPIED`, NO `patientName`: ese campo queda residual en camas ya liberadas
 * (ver suggestedRoomSex). Sin vecinos en UTI/UCO/ITR/HRA: son boxes individuales.
 */
export function sharedRoomOccupiedNeighbors(
  beds: readonly Bed[],
  destLabel: string | null | undefined,
  originLabel?: string | null,
): Bed[] {
  if (!destLabel) return [];
  const dest = beds.find(b => b.label === destLabel);
  if (!dest?.roomCode || isIndividualBoxArea(dest.area)) return [];
  return beds.filter(b =>
    b.label !== dest.label &&
    b.label !== originLabel &&
    b.roomCode === dest.roomCode &&
    b.area === dest.area &&
    b.status === BedStatus.OCCUPIED,
  );
}

export function roomCheckFor(
  beds: readonly Bed[],
  destLabel: string | null | undefined,
  originLabel?: string | null,
  requisitos?: readonly string[] | null,
): RoomCheck {
  const neighbors = sharedRoomOccupiedNeighbors(beds, destLabel, originLabel);
  const reqs = realRequisitos(requisitos);
  const shared = neighbors.length > 0;
  return { required: shared || reqs.length > 0, shared, neighbors, requisitos: reqs };
}

/**
 * Estado inicial de un traslado al asignarle destino. Misma regla que había en los tres lugares que
 * la repetían (alta, "Configurar destino" de un pre-ticket y edición de destino), más la
 * confirmación obligatoria de la azafata cuando `check.required`:
 *   - Disponible y sin nada que verificar → "Habitación Lista" (cama Asignada).
 *   - En preparación, o Disponible pero con verificación pendiente → "Esperando Habitación"
 *     (la cama se muestra "En preparación" hasta que la azafata confirme).
 */
export function destinationState(
  rawStatus: BedStatus | undefined,
  check: RoomCheck,
): { status: TicketStatus.IN_TRANSIT | TicketStatus.WAITING_ROOM; destinationBedStatus: BedStatus; isDestAvailable: boolean } {
  const isDestAvailable = rawStatus === BedStatus.AVAILABLE && !check.required;
  return {
    status: isDestAvailable ? TicketStatus.IN_TRANSIT : TicketStatus.WAITING_ROOM,
    destinationBedStatus: isDestAvailable ? BedStatus.ASSIGNED : BedStatus.PREPARATION,
    isDestAvailable,
  };
}

/** Texto corto de los motivos (para banners y toasts): "habitación compartida con cama ocupada · requiere Con colchón". */
export function describeRoomCheck(check: RoomCheck): string {
  const parts: string[] = [];
  if (check.shared) parts.push('habitación compartida con la cama contigua ocupada');
  if (check.requisitos.length) parts.push(`requiere ${check.requisitos.join(', ')}`);
  return parts.join(' · ');
}
