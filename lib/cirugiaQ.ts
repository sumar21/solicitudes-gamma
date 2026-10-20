/**
 * "Q" del Mapa de Camas: paciente de internación QUIRÚRGICA (admissionTypeCode 'Q' de PROGAL) pendiente
 * de su cirugía (pedido del 20/10/2026).
 *
 * Cada cirugía firma su consentimiento: el Q se auto-habilita SOLO para su primera cirugía DE ESTA
 * INTERNACIÓN. Si ya tuvo una (cerrada con "Iniciar dieta") y no firmó un consentimiento nuevo, la Q no se
 * muestra. Si firmó uno nuevo, Admisión lo marca y la celda muestra "Re-Cx" (no se duplica con la Q). Con
 * una cirugía viva manda la pill Cx. Misma regla que el gate del POST de api/cirugia.ts y que
 * `patientTieneCxCompletada` del detalle (BedsView): las completadas SIN internación (event_key null)
 * cuentan siempre — ante falta de dato no se habilita de más.
 * Puro. Self-check: npx tsx scripts/check-cirugia-q.mts
 */

export interface CirugiaCompletada {
  pacienteCodigo: string;
  /** `${EVE_ORIGEN}-${EVE_NUMERO}` de la internación en la que se operó (puede faltar en filas viejas). */
  eventKey?: string;
}

/** ¿El paciente ya tuvo una cirugía completada en ESTA internación? */
export function cirugiaCompletadaEnInternacion(
  completadas: readonly CirugiaCompletada[],
  patientCode: string | undefined,
  eventKey: string | undefined,
): boolean {
  const code = String(patientCode ?? '').trim();
  if (!code) return false;
  const ekey = String(eventKey ?? '').trim();
  return completadas.some(c => c.pacienteCodigo === code && (!ekey || !c.eventKey || c.eventKey === ekey));
}

/** ¿Mostrar la "Q" en la celda? Quirúrgico, ocupando la cama, sin cirugía viva, sin marca de Admisión
 *  (esa muestra "Re-Cx") y sin una cirugía ya completada en esta internación. */
export function mostrarQ(
  bed: { status?: string; admissionTypeCode?: string; patientCode?: string; cirugia?: unknown; goingToSurgery?: boolean },
  eventKey: string | undefined,
  completadas: readonly CirugiaCompletada[],
): boolean {
  if (bed.status !== 'Ocupada') return false;
  if (String(bed.admissionTypeCode ?? '').trim().toUpperCase() !== 'Q') return false;
  if (bed.cirugia || bed.goingToSurgery) return false;
  return !cirugiaCompletadaEnInternacion(completadas, bed.patientCode, eventKey);
}
