/**
 * Helpers de presentación de ayunos, client-side, en hora Argentina.
 *
 * Desde la migración de Progal (jun-2026) la API devuelve las ocurrencias de ayuno NO
 * ejecutadas ya resueltas (`PAT_FECHA_HORA` por fila). El front YA NO calcula ocurrencias
 * a partir de horas + repeticiones: solo formatea y agrupa lo recibido.
 *
 * Las fechas de Gamma son naive ("2026-06-10T12:00:00") = hora Argentina. Las parseamos
 * por partes para NO depender de la TZ del dispositivo (`new Date` la aplicaría) y las
 * mostramos tal cual llegan (ya vienen en ART, no hay que convertir nada).
 */

import type { Bed } from '../types';

type Indication = { occurrences: string[] };

function parseArtParts(iso: string): { Y: number; M: number; D: number; h: number; min: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return { Y: +m[1], M: +m[2], D: +m[3], h: +m[4], min: +m[5] };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Formatea una ocurrencia (PAT_FECHA_HORA naive ART) a "DD/MM HH:MM". */
export function formatFastingDateTime(iso: string): string {
  const p = parseArtParts(iso);
  if (!p) return iso;
  return `${pad(p.D)}/${pad(p.M)} ${pad(p.h)}:${pad(p.min)}`;
}

/** Ocurrencias de una indicación, ordenadas asc (ISO). Para el modal de la cama. */
export function fastingOccurrences(ind: Indication): string[] {
  return [...(ind.occurrences ?? [])].sort();
}

/** ¿El paciente tiene algún ayuno vigente? (para el ícono de la tarjeta y el filtro) */
export function hasLiveFasting(fasting: Bed['fasting'] | undefined): boolean {
  return !!fasting?.indications?.some(i => (i.occurrences?.length ?? 0) > 0);
}

/**
 * Ayunos de HOY (ART) formateados "HH:MM", únicos y ordenados. Útil para listados/PDFs
 * "del día" — la API puede devolver ocurrencias de varios días (ver ejemplo en
 * api/ayunos.ts); acá filtramos solo las de la jornada ART actual.
 */
export function fastingTimesForToday(
  fasting: Bed['fasting'] | undefined,
  now: number = Date.now(),
): string[] {
  if (!fasting?.indications?.length) return [];
  // Y-M-D del "hoy" del usuario en ART (en-CA da formato YYYY-MM-DD).
  const todayYMD = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

  const times = new Set<string>();
  for (const ind of fasting.indications) {
    for (const occ of ind.occurrences ?? []) {
      const p = parseArtParts(occ);
      if (!p) continue;
      if (`${p.Y}-${pad(p.M)}-${pad(p.D)}` === todayYMD) times.add(`${pad(p.h)}:${pad(p.min)}`);
    }
  }
  return Array.from(times).sort();
}
