/**
 * Parseo y cálculo de ocurrencias de ayunos a partir del campo AYUNOS[] del evento Gamma.
 *
 * Cada elemento del array es UNA fila (planificación, hora). Filas con el mismo
 * PEA_ID_PLANIFICACION + PEA_FECHA_HORA_INICIO componen una indicación con N horas.
 *
 * PEA_CANTIDAD_REPETICIONES es el TOTAL de ocurrencias de la indicación
 * (ciclando por las horas en orden cronológico, día por día) — NO "veces por hora".
 * Si falta (la carga en origen lo dejó vacío), `total` queda en null y mostramos
 * solo el primer ciclo (día de inicio) para no ocultar el ayuno por completo.
 *
 * Ejemplos:
 *   - startISO=2026-05-18 09:42, hours=[10,11,12,13], total=4
 *     → 4 ocurrencias: 18 10:00, 18 11:00, 18 12:00, 18 13:00.
 *
 *   - startISO=2026-05-19 14:51, hours=[0,22,23], total=12
 *     → 12 ocurrencias en orden: 19 22:00, 19 23:00, 20 00:00, 20 22:00,
 *       20 23:00, 21 00:00, 21 22:00, 21 23:00, 22 00:00, 22 22:00, 22 23:00,
 *       23 00:00.
 */

import type { GammaEvent } from './gamma-client.js';

export interface FastingIndication {
  indicationId: number;
  startISO: string;
  hours: number[];                 // ordenadas asc
  totalOccurrences: number | null; // null = repeticiones no especificadas en origen
  upcoming: string[];              // próximas hasta 5 ocurrencias futuras (ISO), para el modal
}

export interface FastingSummary {
  hasUpcoming: boolean;
  nextAt?: string;
  indications: FastingIndication[];
}

type Raw = NonNullable<GammaEvent['AYUNOS']>[number];

/** Agrupa filas crudas por (PEA_ID_PLANIFICACION, PEA_FECHA_HORA_INICIO). */
function groupRaws(rows: Raw[]): Map<string, { id: number; startISO: string; hours: number[]; total: number | null }> {
  const out = new Map<string, { id: number; startISO: string; hours: number[]; total: number | null }>();
  for (const r of rows) {
    // La API devuelve PEA_ID_PLANIFICACION; aceptamos PEA_ID_INDICACION como fallback.
    const planId = r?.PEA_ID_PLANIFICACION ?? r?.PEA_ID_INDICACION;
    if (planId == null || r?.PEA_FECHA_HORA_INICIO == null || r?.PAH_HORA == null) continue;
    const key = `${planId}|${r.PEA_FECHA_HORA_INICIO}`;
    let entry = out.get(key);
    if (!entry) {
      // total null cuando la carga en origen no especificó repeticiones.
      const rawTotal = r.PEA_CANTIDAD_REPETICIONES;
      entry = {
        id: Number(planId),
        startISO: String(r.PEA_FECHA_HORA_INICIO),
        hours: [],
        total: (rawTotal == null || Number(rawTotal) <= 0) ? null : Number(rawTotal),
      };
      out.set(key, entry);
    }
    if (!entry.hours.includes(Number(r.PAH_HORA))) entry.hours.push(Number(r.PAH_HORA));
  }
  for (const v of out.values()) v.hours.sort((a, b) => a - b);
  return out;
}

/**
 * Genera la secuencia de timestamps de una indicación, en orden cronológico,
 * hasta llegar a `total` ocurrencias.
 *
 * El "día 0" es el día calendario de startISO. Cada día siguiente reinicia el ciclo
 * de horas. Solo cuentan las ocurrencias cuyo timestamp >= startISO (descarta horas
 * del día 0 que ya pasaron antes del inicio).
 */
function generateOccurrences(startISO: string, hours: number[], total: number | null): Date[] {
  if (hours.length === 0) return [];

  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return [];

  // Base del día 0 = startISO normalizado a 00:00 LOCAL del mismo día calendario.
  const day0 = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);

  // Sin repeticiones conocidas → solo el primer ciclo (día de inicio).
  const effectiveTotal = total ?? hours.length;
  const maxDays = total === null ? 1 : 365;

  const out: Date[] = [];
  // Tope de seguridad: no recorrer más allá de N días razonables aunque "total" sea grande.
  for (let d = 0; out.length < effectiveTotal && d < maxDays; d++) {
    for (const h of hours) {
      const t = new Date(day0);
      t.setDate(day0.getDate() + d);
      t.setHours(h, 0, 0, 0);
      if (t.getTime() < start.getTime()) continue;
      out.push(t);
      if (out.length >= effectiveTotal) break;
    }
  }
  return out;
}

/** Resumen para el ícono de la tarjeta + lista de indicaciones para el modal. */
export function summarizeFasting(
  ayunos: GammaEvent['AYUNOS'] | undefined,
  now: Date = new Date(),
): FastingSummary | undefined {
  if (!Array.isArray(ayunos) || ayunos.length === 0) return undefined;

  const groups = groupRaws(ayunos);
  if (groups.size === 0) return undefined;

  // Umbral: el ícono no debe parpadear durante la hora del ayuno. Toleramos 1h hacia atrás.
  const graceMs = 60 * 60 * 1000;
  const cutoff = now.getTime() - graceMs;

  const indications: FastingIndication[] = [];
  let nextAtMs = Infinity;

  for (const g of groups.values()) {
    const occ = generateOccurrences(g.startISO, g.hours, g.total);
    // Próximas ocurrencias respecto a "now" (no respecto al cutoff con gracia).
    const future = occ.filter(d => d.getTime() >= now.getTime());
    if (future.length > 0) {
      const firstMs = future[0].getTime();
      if (firstMs < nextAtMs) nextAtMs = firstMs;
    }
    // Para el modal: las próximas 5 ocurrencias dentro de la indicación.
    // Si no hay futuras, mostramos las últimas 5 históricas (puede haber gracia).
    const display = (future.length > 0 ? future : occ.slice(-5)).slice(0, 5);

    indications.push({
      indicationId: g.id,
      startISO: g.startISO,
      hours: g.hours,
      totalOccurrences: g.total,
      upcoming: display.map(d => d.toISOString()),
    });
  }

  // hasUpcoming: alguna indicación tiene una ocurrencia ≥ cutoff (now - 1h).
  const hasUpcoming = Array.from(groups.values()).some(g => {
    const occ = generateOccurrences(g.startISO, g.hours, g.total);
    return occ.some(d => d.getTime() >= cutoff);
  });

  return {
    hasUpcoming,
    nextAt: nextAtMs === Infinity ? undefined : new Date(nextAtMs).toISOString(),
    indications,
  };
}
