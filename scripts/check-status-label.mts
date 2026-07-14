/**
 * Self-check de statusChangeLabel (hooks/useHospitalState.ts, cambio D3).
 *
 * REPLICA la tabla de rank y la regla anti-retroceso porque statusChangeLabel es una
 * función pura NO exportada del módulo — no la exportamos sólo para testear (ensuciaría
 * el módulo). El único riesgo real es que el rank/regla acá diverja del original: si eso
 * pasa, este check no protege nada, así que mantené ambos en sync si tocás el orden.
 *
 * Uso: npx tsx scripts/check-status-label.mts
 */
import assert from 'node:assert';

// Valores string reales del enum TicketStatus (types.ts) — el módulo los usa como llaves.
const S = {
  WAITING_ROOM: 'Esperando Habitacion',
  IN_TRANSIT: 'Habitacion Lista',
  IN_TRANSPORT: 'En Traslado',
  WAITING_CONSOLIDATION: 'Por Consolidar',
  COMPLETED: 'Consolidado',
  REJECTED: 'Cancelado',
} as const;

// ── Réplica EXACTA de statusChangeLabel ──────────────────────────────────────
function statusChangeLabel(_from: string, to: string): { title: string } | null {
  const rank: Record<string, number> = {
    [S.WAITING_ROOM]: 0,
    [S.IN_TRANSIT]: 1,
    [S.IN_TRANSPORT]: 2,
    [S.WAITING_CONSOLIDATION]: 3,
    [S.COMPLETED]: 4,
  };
  const rFrom = rank[_from];
  const rTo   = rank[to];
  if (rFrom !== undefined && rTo !== undefined && rTo < rFrom) return null;
  switch (to) {
    case S.IN_TRANSIT:             return { title: 'Habitacion Lista' };
    case S.IN_TRANSPORT:           return { title: 'Traslado en Curso' };
    case S.WAITING_CONSOLIDATION:  return { title: 'Recepcion Confirmada' };
    case S.COMPLETED:              return { title: 'Traslado Consolidado' };
    case S.REJECTED:               return { title: 'Traslado Cancelado' };
    default: return null;
  }
}

// Forward: avanza en el workflow → debe devolver título.
assert.deepStrictEqual(statusChangeLabel(S.WAITING_ROOM, S.IN_TRANSIT), { title: 'Habitacion Lista' });
assert.deepStrictEqual(statusChangeLabel(S.WAITING_CONSOLIDATION, S.COMPLETED), { title: 'Traslado Consolidado' });

// Backward (poll stale): retrocede en el workflow → debe devolver null (sin notif espuria).
assert.strictEqual(statusChangeLabel(S.COMPLETED, S.WAITING_CONSOLIDATION), null);
assert.strictEqual(statusChangeLabel(S.IN_TRANSPORT, S.IN_TRANSIT), null);
assert.strictEqual(statusChangeLabel(S.WAITING_CONSOLIDATION, S.WAITING_ROOM), null);

// Mismo estado: la regla es rank(to) < rank(from) (estricto), así que NO suprime →
// devuelve título. (El caller sólo invoca en transiciones reales, esto sólo documenta.)
assert.deepStrictEqual(statusChangeLabel(S.IN_TRANSIT, S.IN_TRANSIT), { title: 'Habitacion Lista' });

// REJECTED es terminal (fuera del rank): cancelar desde cualquier estado nunca se suprime.
assert.deepStrictEqual(statusChangeLabel(S.COMPLETED, S.REJECTED), { title: 'Traslado Cancelado' });
assert.deepStrictEqual(statusChangeLabel(S.WAITING_ROOM, S.REJECTED), { title: 'Traslado Cancelado' });

console.log('OK check-status-label: forward=title, backward=null, same=title, rejected=title');
