/**
 * Procesamiento del campo AYUNOS[] del evento Gamma.
 *
 * Desde la migración de Progal (jun-2026), la API devuelve los ayunos NO ejecutados
 * (vigentes) ya resueltos: cada fila es UNA ocurrencia concreta con su fecha/hora exacta
 * en `PAT_FECHA_HORA`. El front YA NO calcula ocurrencias a partir de horas + repeticiones
 * (eso ocultaba suspensiones individuales, recargas, etc.) — solo agrupa por indicación
 * y muestra/almacena lo recibido.
 *
 * Cada fila trae:
 *   · PEA_ID_PLANIFICACION — identifica la indicación (agrupa sus ocurrencias).
 *     Aceptamos PEA_ID_INDICACION como fallback por compatibilidad de nombre.
 *   · PAT_FECHA_HORA — fecha y hora de la ocurrencia (hora Argentina, naive sin tz).
 *   · PEA_FECHA_HORA_INICIO — cuándo se cargó la indicación; informativo, NO se usa.
 *
 * Ejemplo (un paciente con dos indicaciones, plan 2 y plan 3):
 *   plan 3 → 2026-06-10 12:00, 14:00, 16:00; 2026-06-11 12:00
 *   plan 2 → 2026-06-10 18:00, 19:00;        2026-06-11 19:00, 20:00
 */

import { simpleHash, type GammaEvent } from './gamma-client.js';

export interface FastingIndication {
  indicationId: number;
  // Ocurrencias (PAT_FECHA_HORA) en ISO naive ART, ordenadas asc y sin duplicados.
  occurrences: string[];
}

export interface FastingSummary {
  hasUpcoming: boolean;   // true si hay al menos una ocurrencia (todas vigentes)
  nextAt?: string;        // primera ocurrencia (ISO), para ordenar/mostrar "próximo"
  indications: FastingIndication[];
}

/**
 * Agrupa las ocurrencias crudas por indicación y arma el summary que persistimos en
 * 12.EnrichCamas y consume el front. Devuelve `undefined` cuando no hay ayunos vigentes.
 */
export function summarizeFasting(
  ayunos: GammaEvent['AYUNOS'] | undefined,
): FastingSummary | undefined {
  if (!Array.isArray(ayunos) || ayunos.length === 0) return undefined;

  // indicationId → set de PAT_FECHA_HORA (dedupe por si la API repite filas).
  const byPlan = new Map<number, Set<string>>();
  for (const r of ayunos) {
    const planId = r?.PEA_ID_PLANIFICACION ?? r?.PEA_ID_INDICACION;
    const when = r?.PAT_FECHA_HORA;
    if (planId == null || when == null) continue;
    const id = Number(planId);
    let set = byPlan.get(id);
    if (!set) { set = new Set(); byPlan.set(id, set); }
    set.add(String(when));
  }
  if (byPlan.size === 0) return undefined;

  const indications: FastingIndication[] = [];
  let nextAt: string | undefined;
  for (const [indicationId, set] of byPlan) {
    // ISO naive con mismo formato → orden lexicográfico == cronológico.
    const occurrences = Array.from(set).sort();
    if (occurrences.length === 0) continue;
    indications.push({ indicationId, occurrences });
    if (nextAt === undefined || occurrences[0] < nextAt) nextAt = occurrences[0];
  }
  if (indications.length === 0) return undefined;

  // Orden estable de indicaciones (por id) para que el hash no dependa del orden del Map.
  indications.sort((a, b) => a.indicationId - b.indicationId);

  return { hasUpcoming: true, nextAt, indications };
}

/**
 * Hash estable del estado de ayunos de un evento — para detectar cambios entre corridas
 * del cron (análogo a hashTags de dietas).
 *
 * Devuelve `'none'` cuando no hay ayunos (centinela explícito): así el cron puede
 * distinguir "sin ayunos" de "snapshot nunca inicializado" (campo SP vacío) y no spamear
 * el primer ciclo. Usa solo campos estables (id de indicación + ocurrencias) → no depende
 * de `now`.
 */
export function fastingHash(ayunos: GammaEvent['AYUNOS'] | undefined): string {
  const summary = summarizeFasting(ayunos);
  if (!summary || summary.indications.length === 0) return 'none';
  const sig = summary.indications
    .map(i => `${i.indicationId}:${i.occurrences.join(',')}`)
    .sort()
    .join('|');
  return simpleHash(sig);
}
