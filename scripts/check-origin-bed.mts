// Self-check de lib/originBed (bloqueo por cama de origen + tickets huérfanos).
// Correr:  npx tsx scripts/check-origin-bed.mts
import assert from 'node:assert';
import {
  activeTicketsByOrigin, bedHasTicketPatient, describeOriginBedBusy, findOrphanTickets, findPatientBed, isActiveTicket,
} from '../lib/originBed';
import { Area, BedStatus, SedeType, TicketStatus, WorkflowType, type Bed, type Ticket } from '../types';

const ITR3 = 'Internación Transitoria HPR - Cama 03';
const bed = (p: Partial<Bed>): Bed => ({ id: p.label!, label: p.label!, area: Area.HIT, status: BedStatus.OCCUPIED, ...p });
const ticket = (p: Partial<Ticket>): Ticket => ({
  id: 'TSL-1', sede: SedeType.HPR, patientName: 'PACIENTE', origin: ITR3, destination: null,
  workflow: WorkflowType.PRE_TICKET, status: TicketStatus.PRESOLICITUD, createdAt: '2026-10-13T22:14:28.000Z',
  date: '2026-10-13', isBedClean: false, isReasonValidated: true, ...p,
} as Ticket);

// Caso real 14/10/2026 (datos anonimizados): pre-ticket de la paciente A cargado en ITR Cama 03; por PROGAL la
// pasaron a la Cama 05 y en la 03 entró el paciente B.
const ITR5 = 'Internación Transitoria HPR - Cama 05';
const pacA = ticket({ id: 'TSL-92-13102026191400', patientName: 'PACIENTE A', patientCode: '1001' });
const pacB = bed({ label: ITR3, patientName: 'PACIENTE B', patientCode: '1002' });
const aEn5 = bed({ label: ITR5, patientName: 'PACIENTE A', patientCode: '1001' });
const mapa = [pacB, aEn5];

// 1) Activos: todo menos Consolidado y Cancelado; un ticket por cama de origen.
assert(isActiveTicket(pacA), 'Presolicitud es activo');
assert(!isActiveTicket(ticket({ status: TicketStatus.COMPLETED })) && !isActiveTicket(ticket({ status: TicketStatus.REJECTED })), 'terminales no');
const byOrigin = activeTicketsByOrigin([
  ticket({ id: 'A', origin: 'X', status: TicketStatus.REJECTED }),
  ticket({ id: 'B', origin: 'X', status: TicketStatus.WAITING_ROOM }),
  pacA,
]);
assert(byOrigin.get('X')?.id === 'B' && byOrigin.get(ITR3)?.id === pacA.id && byOrigin.size === 2, 'mapa por cama de origen');

// 2) Mismo paciente: por código; si falta el código en un lado, por nombre.
assert(!bedHasTicketPatient(pacB, pacA), 'código distinto → otro paciente');
assert(bedHasTicketPatient(bed({ label: ITR3, patientCode: '1001', patientName: 'X' }), pacA), 'mismo código');
assert(bedHasTicketPatient(bed({ label: ITR3, patientName: 'paciente a ' }), pacA), 'sin código → por nombre');
assert(!bedHasTicketPatient(bed({ label: ITR3, status: BedStatus.AVAILABLE, patientCode: '1001' }), pacA), 'cama libre → no está');

// 3) Dónde está hoy el paciente: por código, fuera de su cama de origen; sin código no se busca.
assert(findPatientBed(mapa, pacA)?.label === ITR5, 'la encuentra en la Cama 05');
assert(!findPatientBed([pacB], pacA), 'no figura en el mapa');
assert(!findPatientBed([bed({ label: ITR5, patientName: 'PACIENTE A' })], { ...pacA, patientCode: undefined }), 'sin código no busca por nombre');
assert(!findPatientBed([bed({ label: ITR3, patientCode: '1001' })], pacA), 'la propia cama de origen no cuenta');

// 4) Huérfanos: solo estados donde el paciente todavía no salió, y solo con OTRO ocupante.
let orphans = findOrphanTickets([pacA], mapa);
const o = orphans.get(pacA.id);
assert(o?.occupantName === 'PACIENTE B' && o.patientNowAt === ITR5 && !o.patientNotInMap, 'caso real: ocupante actual + dónde está ella');
orphans = findOrphanTickets([pacA], [pacB]);
assert(orphans.get(pacA.id)?.patientNotInMap === true && !orphans.get(pacA.id)?.patientNowAt, 'no figura en el mapa (¿alta?)');
assert(findOrphanTickets([{ ...pacA, patientCode: undefined }], [pacB]).get(pacA.id)?.patientNotInMap === false, 'sin código no afirma que no está');
for (const status of [TicketStatus.WAITING_ROOM, TicketStatus.IN_TRANSIT]) {
  assert(findOrphanTickets([{ ...pacA, status }], [pacB]).size === 1, `${status} con otro ocupante → huérfano`);
}
for (const status of [TicketStatus.IN_TRANSPORT, TicketStatus.WAITING_CONSOLIDATION, TicketStatus.COMPLETED, TicketStatus.REJECTED]) {
  assert(findOrphanTickets([{ ...pacA, status }], [pacB]).size === 0, `${status}: el paciente ya salió → no se marca`);
}
assert(findOrphanTickets([pacA], [bed({ label: ITR3, patientCode: '1001', patientName: 'PACIENTE A' })]).size === 0, 'sigue en la cama → no');
assert(findOrphanTickets([pacA], [bed({ label: ITR3, status: BedStatus.AVAILABLE })]).size === 0, 'cama vacía → no alcanza (Sala de Espera / PROGAL adelantado)');
assert(findOrphanTickets([pacA], []).size === 0, 'mapa sin cargar → nada');
assert(findOrphanTickets([{ ...pacA, origin: 'Otra cama' }], [pacB]).size === 0, 'cama que no está en el mapa → nada');

// 5) Texto del aviso.
let d = describeOriginBedBusy(pacA, mapa);
assert(d.otherPatient && d.title === 'La cama tiene un pre-ticket de otro paciente', 'título huérfano');
assert(d.message.includes('PACIENTE A') && d.message.includes('TSL-92-13102026191400') && d.message.includes('Ya no está en la cama'),
  'nombra al paciente, el TSL y la marca de Operativa');
assert(/hoy está en .*Cama 05/i.test(d.message) && d.message.includes('cama nueva'), 'dice dónde está hoy y que se recargue desde la cama nueva');
d = describeOriginBedBusy(pacA, [pacB]);
assert(d.otherPatient && d.message.includes('ninguna cama del mapa'), 'no figura en el mapa');
d = describeOriginBedBusy(pacA, [bed({ label: ITR3, patientCode: '1001', patientName: 'PACIENTE A' })]);
assert(!d.otherPatient && d.title === 'Ya hay un pre-ticket activo para esta cama', 'mismo paciente');
d = describeOriginBedBusy({ ...pacA, status: TicketStatus.WAITING_ROOM }, []);
assert(!d.otherPatient && d.title === 'Ya hay un traslado activo para esta cama', 'sin cama conocida → genérico, "traslado"');
d = describeOriginBedBusy({ ...pacA, status: TicketStatus.WAITING_CONSOLIDATION }, mapa);
assert(d.otherPatient && d.title === 'La cama tiene un traslado sin cerrar' && d.message.includes('Por Consolidar'), 'Por Consolidar con otro ocupante');

console.log('OK — originBed: bloqueo por cama de origen, huérfanos y avisos');
