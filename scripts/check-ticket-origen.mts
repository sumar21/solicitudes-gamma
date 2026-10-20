// Self-check del origen automático y de "Restablecer destino" (20/10/2026):
//   lib/originBed (findOriginMoves, puedeRestablecerDestino) + api/ticket-origen (validaciones del PATCH).
// Correr:  npx tsx scripts/check-ticket-origen.mts
import assert from 'node:assert';
import { findOriginMoves, puedeRestablecerDestino } from '../lib/originBed';
import { validarReubicarOrigen, validarRestablecerDestino } from '../api/ticket-origen';
import { Area, BedStatus, SedeType, TicketStatus, WorkflowType, type Bed, type Ticket } from '../types';

const H4071 = 'Habitacion 407 HPR - Cama 01', H4072 = 'Habitacion 407 HPR - Cama 02', H501 = 'Habitacion 501 HPR - Cama 01';
const bed = (p: Partial<Bed>): Bed => ({ id: p.label!, label: p.label!, area: Area.PISO_4, status: BedStatus.OCCUPIED, ...p });
const ticket = (p: Partial<Ticket>): Ticket => ({
  id: 'TSL-1', sede: SedeType.HPR, patientName: 'PACIENTE A', patientCode: '1001', origin: H4071, destination: null,
  workflow: WorkflowType.PRE_TICKET, status: TicketStatus.PRESOLICITUD, createdAt: '2026-10-20T10:00:00.000Z',
  date: '2026-10-20', isBedClean: false, isReasonValidated: true, ...p,
} as Ticket);

// Caso del pedido de Gamma (anonimizado): pre-ticket del paciente A desde la 407.1; por PROGAL lo pasan a la 407.2.
const aEn4072 = bed({ label: H4072, patientName: 'PACIENTE A', patientCode: '1001', bedCode: 'C4072', area: Area.PISO_4 });
const vacia4071 = bed({ label: H4071, status: BedStatus.AVAILABLE });
const pre = ticket({});

// ── findOriginMoves ──────────────────────────────────────────────────────────
let mv = findOriginMoves([pre], [vacia4071, aEn4072]);
assert.deepEqual(mv, [{ ticketId: 'TSL-1', from: H4071, to: H4072, toCode: 'C4072', toArea: Area.PISO_4, patientCode: '1001' }], 'cama vieja vacía + paciente en la nueva → reubicar');
// La cama vieja con OTRO paciente (el caso huérfano del 14/10) también.
mv = findOriginMoves([pre], [bed({ label: H4071, patientCode: '2000', patientName: 'PACIENTE B' }), aEn4072]);
assert(mv.length === 1 && mv[0].to === H4072, 'cama vieja ocupada por otro → reubicar');
// Traslado configurado (Esperando Habitación / Habitación Lista) también; ya en traslado, no.
assert(findOriginMoves([ticket({ status: TicketStatus.WAITING_ROOM, destination: H501 })], [vacia4071, aEn4072]).length === 1, 'Esperando Habitación');
assert(findOriginMoves([ticket({ status: TicketStatus.IN_TRANSIT, destination: H501 })], [vacia4071, aEn4072]).length === 1, 'Habitación Lista');
assert(findOriginMoves([ticket({ status: TicketStatus.IN_TRANSPORT, destination: H501 })], [vacia4071, aEn4072]).length === 0, 'En Traslado: ya salió');
assert(findOriginMoves([ticket({ status: TicketStatus.WAITING_CONSOLIDATION, destination: H501 })], [vacia4071, aEn4072]).length === 0, 'Por Consolidar: ya salió');
// PROGAL adelantado: el paciente figura en el DESTINO del traslado → no se toca el origen.
assert(findOriginMoves([ticket({ status: TicketStatus.WAITING_ROOM, destination: H4072 })], [vacia4071, aEn4072]).length === 0, 'paciente en el destino → no');
// El paciente sigue en la vieja (aunque figure también en otra): PROGAL a mitad de camino → no.
assert(findOriginMoves([pre], [bed({ label: H4071, patientCode: '1001' }), aEn4072]).length === 0, 'sigue en la vieja');
// Figura en dos camas nuevas: ambiguo → no.
assert(findOriginMoves([pre], [vacia4071, aEn4072, bed({ label: H501, patientCode: '1001' })]).length === 0, 'dos camas nuevas');
// Sin código: no se busca por nombre (homónimos).
assert(findOriginMoves([ticket({ patientCode: undefined })], [vacia4071, bed({ label: H4072, patientName: 'PACIENTE A' })]).length === 0, 'sin código');
// Origen fuera del mapa (mapa parcial o sentinela) → no; mapa vacío → no.
assert(findOriginMoves([pre], [aEn4072]).length === 0, 'origen fuera del mapa');
assert(findOriginMoves([pre], []).length === 0, 'mapa vacío');
// Urgencias no (tienen su propio circuito).
assert(findOriginMoves([ticket({ urgencia: true })], [vacia4071, aEn4072]).length === 0, 'urgencia');
// Otro pedido activo ya sale de la cama nueva → no (quedarían dos pedidos desde la misma cama).
assert(findOriginMoves([pre, ticket({ id: 'TSL-2', origin: H4072, patientCode: '3000' })], [vacia4071, aEn4072]).length === 0, 'cama nueva con otro pedido');
// Terminales no.
assert(findOriginMoves([ticket({ status: TicketStatus.REJECTED })], [vacia4071, aEn4072]).length === 0, 'cancelado');

// ── validarReubicarOrigen (servidor) ─────────────────────────────────────────
const NOW = Date.parse('2026-10-20T12:00:00Z');
const row = { status: TicketStatus.PRESOLICITUD, cama_origen: H4071, cama_destino: null, codigo_paciente: '1001', updated_at: '2026-10-20T11:00:00Z' };
const body = { from: H4071, to: H4072, patientCode: '1001', mapaEdadMs: 30_000 };
assert.deepEqual(validarReubicarOrigen(row, body, NOW), { ok: true }, 'caso feliz');
assert.deepEqual(validarReubicarOrigen({ ...row, cama_origen: H4072 }, body, NOW), { ok: true, noop: true }, 'ya reubicado por otro dispositivo → noop');
assert.equal(validarReubicarOrigen({ ...row, cama_origen: H501 }, body, NOW).status, 409, 'el origen cambió');
assert.equal(validarReubicarOrigen({ ...row, status: TicketStatus.IN_TRANSPORT }, body, NOW).status, 409, 'ya salió');
assert.equal(validarReubicarOrigen({ ...row, codigo_paciente: '2000' }, body, NOW).status, 409, 'otro paciente');
assert.equal(validarReubicarOrigen({ ...row, codigo_paciente: null }, body, NOW).status, 409, 'fila sin código');
assert.equal(validarReubicarOrigen({ ...row, cama_destino: H4072 }, body, NOW).status, 409, 'la nueva es el destino');
assert.equal(validarReubicarOrigen(null, body, NOW).status, 404, 'no existe');
assert.equal(validarReubicarOrigen(row, { ...body, to: H4071 }, NOW).status, 400, 'from == to');
assert.equal(validarReubicarOrigen(row, { ...body, mapaEdadMs: undefined }, NOW).status, 400, 'sin antigüedad del mapa');
// Mapa viejo: la fila cambió (11:59:50) DESPUÉS del mapa (11:59:30) → 409; un mapa más nuevo pasa.
assert.equal(validarReubicarOrigen({ ...row, updated_at: '2026-10-20T11:59:50Z' }, body, NOW).status, 409, 'mapa anterior al último cambio');
assert.deepEqual(validarReubicarOrigen({ ...row, updated_at: '2026-10-20T11:59:50Z' }, { ...body, mapaEdadMs: 5_000 }, NOW), { ok: true }, 'mapa posterior');

// ── Restablecer destino ──────────────────────────────────────────────────────
const conf = ticket({ status: TicketStatus.IN_TRANSIT, destination: H501, intervenedByHostess: 'NO', canCancel: true });
assert(puedeRestablecerDestino(conf), 'pre-ticket configurado (Habitación Lista) sin azafata');
assert(puedeRestablecerDestino({ ...conf, status: TicketStatus.WAITING_ROOM }), 'Esperando Habitación');
assert(!puedeRestablecerDestino({ ...conf, intervenedByHostess: 'SI', canCancel: false }), 'la azafata ya intervino');
assert(!puedeRestablecerDestino({ ...conf, intervenedByHostess: 'SI', canCancel: undefined }), 'azafata: alcanza con intervenedByHostess');
assert(!puedeRestablecerDestino({ ...conf, intervenedByHostess: undefined, canCancel: false }), 'azafata: alcanza con canCancel');
assert(!puedeRestablecerDestino({ ...conf, status: TicketStatus.PRESOLICITUD, destination: null }), 'sin configurar');
assert(!puedeRestablecerDestino({ ...conf, status: TicketStatus.IN_TRANSPORT }), 'en traslado');
assert(!puedeRestablecerDestino({ ...conf, workflow: WorkflowType.INTERNAL }), 'traslado normal (no pre-ticket)');
assert(!puedeRestablecerDestino({ ...conf, urgencia: true }), 'urgencia');

const r2 = { status: TicketStatus.IN_TRANSIT, workflow: WorkflowType.PRE_TICKET, intervino_azafata: 'NO', urgencia: false };
assert.deepEqual(validarRestablecerDestino(r2), { ok: true }, 'servidor: caso feliz');
assert.deepEqual(validarRestablecerDestino({ ...r2, status: TicketStatus.WAITING_ROOM }), { ok: true }, 'servidor: Esperando Habitación');
assert.deepEqual(validarRestablecerDestino({ ...r2, status: TicketStatus.PRESOLICITUD }), { ok: true, noop: true }, 'servidor: ya sin destino');
assert.equal(validarRestablecerDestino({ ...r2, intervino_azafata: 'si' }).status, 409, 'servidor: azafata (case-insensitive)');
assert.equal(validarRestablecerDestino({ ...r2, workflow: WorkflowType.INTERNAL }).status, 409, 'servidor: no es pre-ticket');
assert.equal(validarRestablecerDestino({ ...r2, urgencia: true }).status, 409, 'servidor: urgencia');
assert.equal(validarRestablecerDestino({ ...r2, status: TicketStatus.IN_TRANSPORT }).status, 409, 'servidor: en traslado');
assert.equal(validarRestablecerDestino(null).status, 404, 'servidor: no existe');

console.log('OK — origen automático + restablecer destino');
