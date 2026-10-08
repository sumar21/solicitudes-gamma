// Self-check de lib/roomCheck ("Solicitar limpieza OK": habitación compartida / requerimientos).
// Correr:  npx tsx scripts/check-room-check.mts
import assert from 'node:assert';
import { destinationState, describeRoomCheck, realRequisitos, roomCheckFor, sharedRoomOccupiedNeighbors } from '../lib/roomCheck';
import { REQUISITO_SIN } from '../lib/constants';
import { Area, BedStatus, TicketStatus, type Bed } from '../types';

const bed = (p: Partial<Bed>): Bed => ({
  id: p.label!, label: p.label!, area: Area.PISO_4, status: BedStatus.OCCUPIED, ...p,
});

// Habitación 401 (compartida): cama 1 ocupada, cama 2 libre y en verde (el caso del hospital).
const occ = bed({ label: 'H401-1', roomCode: '401', status: BedStatus.OCCUPIED, patientName: 'Ana' });
const free = bed({ label: 'H401-2', roomCode: '401', status: BedStatus.AVAILABLE });
const origin = bed({ label: 'H305-1', roomCode: '305', status: BedStatus.OCCUPIED, patientName: 'Juan' });
const all = [occ, free, origin];

// 1) Compartida con vecino ocupado → exige confirmación aunque la cama esté Disponible.
let c = roomCheckFor(all, 'H401-2', 'H305-1', []);
assert(c.shared && c.required && c.neighbors.length === 1, 'compartida con vecino ocupado exige confirmar');
let s = destinationState(BedStatus.AVAILABLE, c);
assert(s.status === TicketStatus.WAITING_ROOM && s.destinationBedStatus === BedStatus.PREPARATION && !s.isDestAvailable,
  'queda Esperando Habitación aunque la cama esté verde');

// 2) Habitación individual (sin vecino) y sin requisitos → pasa directo como siempre.
const solo = bed({ label: 'H501-1', roomCode: '501', status: BedStatus.AVAILABLE });
c = roomCheckFor([solo, origin], 'H501-1', 'H305-1', []);
assert(!c.required && !c.shared, 'sin vecino y sin requisitos no exige nada');
s = destinationState(BedStatus.AVAILABLE, c);
assert(s.status === TicketStatus.IN_TRANSIT && s.destinationBedStatus === BedStatus.ASSIGNED && s.isDestAvailable,
  'cama verde + nada que verificar → Habitación Lista');

// 3) Requisitos reales en habitación individual → exige confirmación.
c = roomCheckFor([solo, origin], 'H501-1', 'H305-1', ['Con colchón']);
assert(c.required && !c.shared && c.requisitos.length === 1, 'requisito real exige confirmar');
assert(destinationState(BedStatus.AVAILABLE, c).status === TicketStatus.WAITING_ROOM, 'con colchón → Esperando Habitación');

// 4) "Sin requerimiento" / vacíos NO cuentan.
assert(realRequisitos([REQUISITO_SIN]).length === 0, 'Sin requerimiento no cuenta');
assert(realRequisitos(['', '  ', REQUISITO_SIN]).length === 0, 'vacíos no cuentan');
assert(realRequisitos(undefined).length === 0 && realRequisitos(null).length === 0, 'undefined/null → []');
c = roomCheckFor([solo, origin], 'H501-1', 'H305-1', [REQUISITO_SIN]);
assert(!c.required, 'Sin requerimiento no exige confirmar');

// 5) Cama destino en preparación → Esperando Habitación como siempre (con o sin check).
c = roomCheckFor([solo, origin], 'H501-1', 'H305-1', []);
assert(destinationState(BedStatus.PREPARATION, c).status === TicketStatus.WAITING_ROOM, 'en preparación → Esperando Habitación');
assert(destinationState(undefined, c).status === TicketStatus.WAITING_ROOM, 'sin dato → conservador: Esperando Habitación');

// 6) Cambio de cama DENTRO del mismo cuarto: el "vecino" es el propio paciente → no cuenta.
const self = bed({ label: 'H401-1', roomCode: '401', status: BedStatus.OCCUPIED, patientName: 'Ana' });
assert(sharedRoomOccupiedNeighbors([self, free], 'H401-2', 'H401-1').length === 0, 'el origen no es vecino');
assert(sharedRoomOccupiedNeighbors([self, free], 'H401-2', 'OTRA').length === 1, 'sin ese origen sí lo es');

// 7) Vecino con patientName residual pero NO ocupado → no cuenta (criterio: status, no nombre).
const ghost = bed({ label: 'H401-1', roomCode: '401', status: BedStatus.AVAILABLE, patientName: 'Fantasma' });
assert(sharedRoomOccupiedNeighbors([ghost, free], 'H401-2').length === 0, 'residual de nombre no cuenta');

// 8) Otra habitación u otra área con el mismo roomCode → no son vecinos.
const otherRoom = bed({ label: 'H402-1', roomCode: '402', status: BedStatus.OCCUPIED });
const otherArea = bed({ label: 'U401-1', roomCode: '401', area: Area.PISO_5, status: BedStatus.OCCUPIED });
assert(sharedRoomOccupiedNeighbors([otherRoom, otherArea, free], 'H401-2').length === 0, 'otro cuarto / otra área no cuenta');

// 9) UTI / UCO / ITR / Sala de Espera: boxes individuales → nunca "compartida", aunque haya ocupados.
for (const area of [Area.HUT, Area.HUC, Area.HIT, Area.HRA]) {
  const a = bed({ label: 'B-1', area, roomCode: 'B', status: BedStatus.OCCUPIED });
  const b = bed({ label: 'B-2', area, roomCode: 'B', status: BedStatus.AVAILABLE });
  assert(!roomCheckFor([a, b], 'B-2', 'X').shared, `box individual en ${area} no es compartida`);
}

// 10) Cama destino inexistente / sin roomCode → sin vecinos, no revienta.
assert(sharedRoomOccupiedNeighbors(all, 'NO-EXISTE').length === 0 && sharedRoomOccupiedNeighbors(all, null).length === 0, 'destino ausente');
assert(sharedRoomOccupiedNeighbors([bed({ label: 'S-1', status: BedStatus.AVAILABLE })], 'S-1').length === 0, 'sin roomCode');

// 11) Texto de motivos.
assert(describeRoomCheck(roomCheckFor(all, 'H401-2', 'H305-1', ['Con colchón'])) ===
  'habitación compartida con la cama contigua ocupada · requiere Con colchón', 'descripción combinada');

console.log('OK — roomCheck');
