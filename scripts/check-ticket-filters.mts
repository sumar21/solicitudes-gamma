// Self-check del filtro por estado de Operativa (lib/ticketFilters).
// Correr:  npx tsx scripts/check-ticket-filters.mts
import assert from 'node:assert';
import { applyStatusFilter, countByStatus, toggleStatus, visibleStatusChips } from '../lib/ticketFilters';
import { TicketStatus as S } from '../types';

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
// Coordinación (filtra por pisos Y carga urgencias): ve "Por Consolidar" (sólo urgencias), sin Presolicitud.
assert.deepEqual(visibleStatusChips({ filterByFloors: true, canSeePreTickets: true, canSeeUrgencias: true }),
  [S.WAITING_ROOM, S.IN_TRANSIT, S.IN_TRANSPORT, S.WAITING_CONSOLIDATION, S.REJECTED], 'coordinación ve Por Consolidar');
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

console.log('OK — ticketFilters');
