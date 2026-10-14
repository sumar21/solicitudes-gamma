// Self-check del filtro por estado de Operativa (lib/ticketFilters).
// Correr:  npx tsx scripts/check-ticket-filters.mts
import assert from 'node:assert';
import { applyStatusFilter, countByStatus, toggleStatus, visibleStatusChips, showUrgenciasChip, applyUrgenciaFilter, makeAreaScope } from '../lib/ticketFilters';
import { Area, TicketStatus as S } from '../types';

const t = (id: string, status: S) => ({ id, status });
const tickets = [
  t('a', S.PRESOLICITUD), t('b', S.WAITING_ROOM), t('c', S.WAITING_ROOM), t('d', S.IN_TRANSIT),
  t('e', S.IN_TRANSPORT), t('f', S.WAITING_CONSOLIDATION), t('g', S.WAITING_CONSOLIDATION), t('h', S.WAITING_CONSOLIDATION),
];

// ── Botonera por rol: SOLO los estados que ese usuario puede ver ────────────────
// Admisión / Admin: todo el ciclo + Presolicitud si puede ver pre-tickets. Sin Cancelado (no los ve).
assert.deepEqual(visibleStatusChips({ filterByFloors: false, canSeePreTickets: true }),
  [S.PRESOLICITUD, S.WAITING_ROOM, S.IN_TRANSIT, S.IN_TRANSPORT, S.WAITING_CONSOLIDATION], 'admisión: ciclo completo');
// Rol sin pre-tickets (p. ej. Dirección): sin chip de Presolicitud.
assert.deepEqual(visibleStatusChips({ filterByFloors: false, canSeePreTickets: false }),
  [S.WAITING_ROOM, S.IN_TRANSIT, S.IN_TRANSPORT, S.WAITING_CONSOLIDATION], 'sin pre-tickets');
// Azafata (filtra por pisos): NUNCA ve Por Consolidar ni Presolicitud; sí los cancelados recientes.
const azafata = visibleStatusChips({ filterByFloors: true, canSeePreTickets: false });
assert.deepEqual(azafata, [S.WAITING_ROOM, S.IN_TRANSIT, S.IN_TRANSPORT, S.REJECTED], 'azafata: sólo estados operativos');
assert(!azafata.includes(S.WAITING_CONSOLIDATION) && !azafata.includes(S.PRESOLICITUD), 'azafata no ve Por Consolidar ni Presolicitud');
// Coordinación (filtra por pisos pero CREA tickets): no se recorta por estado → ve el ciclo completo de sus
// sectores, con Presolicitud y Por Consolidar (ahí caen sus urgencias).
assert.deepEqual(visibleStatusChips({ filterByFloors: true, canSeePreTickets: true, canCreateTickets: true }),
  [S.PRESOLICITUD, S.WAITING_ROOM, S.IN_TRANSIT, S.IN_TRANSPORT, S.WAITING_CONSOLIDATION, S.REJECTED], 'coordinación: ciclo completo');
// Un rol que filtra por pisos, crea tickets pero NO ve pre-tickets: sin chip de Presolicitud.
assert(!visibleStatusChips({ filterByFloors: true, canSeePreTickets: false, canCreateTickets: true }).includes(S.PRESOLICITUD), 'sin pre-tickets no hay chip Presolicitud');
// Admin/Admisión en la pestaña "Azafata": solo operativos (sin Presolicitud ni Por Consolidar), aunque pueda crear.
assert.deepEqual(visibleStatusChips({ filterByFloors: false, canSeePreTickets: true, canCreateTickets: true, actingAsHostess: true }),
  [S.WAITING_ROOM, S.IN_TRANSIT, S.IN_TRANSPORT], 'pestaña azafata: solo operativos');
// Consolidado nunca es un chip (la grilla de Operativa no lo muestra).
for (const o of [{ filterByFloors: true, canSeePreTickets: true }, { filterByFloors: false, canSeePreTickets: true }]) {
  assert(!visibleStatusChips(o).includes(S.COMPLETED), 'Consolidado nunca es chip');
}

// ── Contadores ────────────────────────────────────────────────────────────────
const counts = countByStatus(tickets);
assert(counts[S.WAITING_ROOM] === 2 && counts[S.WAITING_CONSOLIDATION] === 3 && counts[S.IN_TRANSIT] === 1, 'conteo por estado');
assert(counts[S.REJECTED] === undefined, 'estado ausente → undefined (la UI lo muestra como 0)');
assert.deepEqual(countByStatus([]), {}, 'lista vacía');

// ── Filtro ────────────────────────────────────────────────────────────────────
assert.equal(applyStatusFilter(tickets, new Set()).length, 8, 'selección vacía = todo');
assert.deepEqual(applyStatusFilter(tickets, new Set([S.WAITING_CONSOLIDATION])).map(x => x.id), ['f', 'g', 'h'], 'un estado');
assert.deepEqual(applyStatusFilter(tickets, new Set([S.WAITING_ROOM, S.IN_TRANSIT])).map(x => x.id), ['b', 'c', 'd'], 'multi-selección');
assert.equal(applyStatusFilter(tickets, new Set([S.REJECTED])).length, 0, 'estado sin tickets → vacío');
const original = [...tickets];
applyStatusFilter(tickets, new Set([S.IN_TRANSIT]));
assert.deepEqual(tickets, original, 'no muta la entrada');
// el resultado es una copia: ordenarlo después no debe reordenar la lista original
const all = applyStatusFilter(tickets, new Set());
all.reverse();
assert.deepEqual(tickets, original, 'selección vacía devuelve COPIA (el padre ordena in-place)');

// ── Toggle inmutable ──────────────────────────────────────────────────────────
const s0 = new Set<S>();
const s1 = toggleStatus(s0, S.WAITING_ROOM);
assert(s1.has(S.WAITING_ROOM) && s0.size === 0 && s1 !== s0, 'prende sin mutar el anterior');
const s2 = toggleStatus(s1, S.IN_TRANSIT);
assert(s2.size === 2, 'multi-selección');
const s3 = toggleStatus(s2, S.WAITING_ROOM);
assert(!s3.has(S.WAITING_ROOM) && s3.has(S.IN_TRANSIT) && s2.has(S.WAITING_ROOM), 'apaga uno sin mutar');

// ── Chip "Urgencias" (flag, no estado) ───────────────────────────────────────
assert.equal(showUrgenciasChip(visibleStatusChips({ filterByFloors: false, canSeePreTickets: true })), true, 'Admisión ve el chip');
assert.equal(showUrgenciasChip(visibleStatusChips({ filterByFloors: true, canSeePreTickets: false })), false, 'azafata no (nunca ve urgencias)');
assert.equal(showUrgenciasChip(visibleStatusChips({ filterByFloors: false, canSeePreTickets: true, actingAsHostess: true })), false, 'pestaña Azafata tampoco');
const conUrg = [{ id: 'u1', status: S.WAITING_CONSOLIDATION, urgencia: true }, { id: 'n1', status: S.WAITING_CONSOLIDATION }, { id: 'n2', status: S.WAITING_ROOM, urgencia: false }];
assert.deepEqual(applyUrgenciaFilter(conUrg, true).map(x => x.id), ['u1'], 'prendido: sólo urgencias');
assert.equal(applyUrgenciaFilter(conUrg, false).length, 3, 'apagado: todo');
assert.notStrictEqual(applyUrgenciaFilter(conUrg, false), conUrg, 'apagado devuelve copia');
assert.deepEqual(applyUrgenciaFilter(applyStatusFilter(conUrg, new Set([S.WAITING_ROOM])), true), [], 'se combina con estados (Y lógico)');

// ── Recorte por sectores (makeAreaScope) ─────────────────────────────────────────
// Coordinación real (14/10/2026): 9 sectores, sin HSS ni HUQ.
const coord = { id: '92', filterByFloors: true, assignedAreas: [
  Area.PISO_4, Area.PISO_5, Area.PISO_6, Area.PISO_7, Area.PISO_8, Area.HIT, Area.HRA, Area.HUC, Area.HUT] };
const azafata4 = { id: '7', filterByFloors: true, assignedAreas: [Area.PISO_4, Area.HRA] };
const mapa = [
  { label: 'Internación Transitoria HPR - Cama 03', area: Area.HIT },
  { label: 'Unidad Coronaria HPR - Cama 02', area: Area.HUC },
  { label: 'Habitación 401 HPR - Cama 01', area: Area.PISO_4 },
  { label: 'Habitación 513 HPR - Cama 02', area: Area.PISO_5 },
  { label: 'Sala de Espera - Sillon 1', area: Area.HRA },
  { label: 'Servicio de Neurofisiologia (Sueño) HPR - Cama 01', area: Area.HSS },
];
const preItr = { origin: 'Internación Transitoria HPR - Cama 03', destination: null, createdById: '91' };
const hraA5  = { origin: 'Sala de Espera - Sillon 1', destination: 'Habitación 513 HPR - Cama 02', createdById: '50' };
const hraA4  = { origin: 'Sala de Espera - Sillon 1', destination: 'Habitación 401 HPR - Cama 01', createdById: '50' };
const deHss  = { origin: 'Servicio de Neurofisiologia (Sueño) HPR - Cama 01', destination: null, createdById: '50' };
let scope = makeAreaScope(coord, mapa);
assert(scope(preItr) && scope(hraA5), 'coordinación ve lo de sus sectores');
assert(!scope(deHss), 'coordinación NO ve un sector que no tiene (HSS)');
assert(makeAreaScope(coord, mapa)({ ...deHss, createdById: '92' }), 'lo que creó no lo pierde aunque esté fuera de sus sectores');
assert(scope({ origin: 'Unidad Coronaria HPR - Cama 09', destination: null }), 'cama no listada pero el label contiene el área → se ubica (UCO)');
// El incidente: mapa de camas PARCIAL (no vacío) → antes se escondía todo. Ahora, si no se ubica ni origen
// ni destino, se muestra.
const parcial = [{ label: 'Habitación 401 HPR - Cama 01', area: Area.PISO_4 }];
scope = makeAreaScope(coord, parcial);
assert(scope(preItr) && scope(hraA5) && scope(deHss), 'mapa parcial: lo que no se puede ubicar se MUESTRA (falla abierto)');
assert(makeAreaScope(azafata4, parcial)({ origin: 'Habitación 401 HPR - Cama 01', destination: 'X' }), 'lo ubicable se sigue evaluando');
assert(!makeAreaScope({ ...azafata4, assignedAreas: [Area.PISO_8] }, parcial)({ origin: 'Habitación 401 HPR - Cama 01', destination: null }),
  'ubicado fuera de sus sectores → no se ve, aunque el mapa sea parcial');
// Sala de Espera: se remapea al piso del otro extremo (la azafata del 4° no ve HRA → 5°).
scope = makeAreaScope(azafata4, mapa);
assert(scope(hraA4) && !scope(hraA5), 'HRA se remapea al piso destino');
// Sin filtro: no filtra por pisos, sin sectores, (casi) todos los sectores, o mapa sin cargar.
assert(makeAreaScope({ id: '1', filterByFloors: false, assignedAreas: [Area.PISO_8] }, mapa)(deHss), 'no filtra por pisos');
assert(makeAreaScope({ ...azafata4, assignedAreas: [] }, mapa)(deHss), 'sin sectores');
assert(makeAreaScope({ ...azafata4, assignedAreas: Object.values(Area).slice(1) }, mapa)(deHss), 'todos menos uno = todos');
assert(makeAreaScope(azafata4, [])(deHss), 'mapa sin cargar → no filtra');
assert(makeAreaScope(null, mapa)(deHss), 'sin usuario → no filtra');

console.log('OK — ticketFilters');
