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
 *
 * IMPORTANTE: la API puede devolver ocurrencias NO canceladas pero ya pasadas (fecha/hora
 * anterior a la actual; p. ej. indicaciones viejas que nadie suspendió). Antes el front las
 * filtraba al calcular ocurrencias; con Progal eso dejó de hacerse. Por eso acá descartamos
 * toda ocurrencia anterior al minuto actual (ART) en TODOS los puntos de consumo
 * (indicador de celda, modal y listados): solo se muestran ayunos vigentes/futuros.
 */

import type { Bed } from '../types';

type Indication = { occurrences: string[] };

function parseArtParts(iso: string): { Y: number; M: number; D: number; h: number; min: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return { Y: +m[1], M: +m[2], D: +m[3], h: +m[4], min: +m[5] };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Clave entera comparable YYYYMMDDHHMM — mismo orden que el cronológico, granularidad de minuto. */
const artKey = (Y: number, M: number, D: number, h: number, min: number): number =>
  ((((Y * 100 + M) * 100 + D) * 100 + h) * 100 + min);

/** "Ahora" en ART como clave comparable (YYYYMMDDHHMM), sin depender de la TZ del dispositivo. */
function nowArtKey(now: number): number {
  const m: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now))) m[part.type] = part.value;
  return artKey(+m.year, +m.month, +m.day, +m.hour, +m.minute);
}

/**
 * ¿La ocurrencia (PAT_FECHA_HORA naive ART) es del minuto actual o futura?
 * Las anteriores al minuto actual son ayunos ya pasados y NO se muestran.
 * Si no se puede parsear, la conservamos (no podemos probar que pasó → fail-open).
 */
function isUpcomingOccurrence(iso: string, nowKey: number): boolean {
  const p = parseArtParts(iso);
  if (!p) return true;
  return artKey(p.Y, p.M, p.D, p.h, p.min) >= nowKey;
}

/** Formatea una ocurrencia (PAT_FECHA_HORA naive ART) a "DD/MM HH:MM". */
export function formatFastingDateTime(iso: string): string {
  const p = parseArtParts(iso);
  if (!p) return iso;
  return `${pad(p.D)}/${pad(p.M)} ${pad(p.h)}:${pad(p.min)}`;
}

/**
 * Ocurrencias VIGENTES de una indicación (del minuto actual o futuras), ordenadas asc (ISO).
 * Para el modal de la cama: descarta las ya pasadas.
 */
export function fastingOccurrences(ind: Indication, now: number = Date.now()): string[] {
  const nowKey = nowArtKey(now);
  return [...(ind.occurrences ?? [])].filter(occ => isUpcomingOccurrence(occ, nowKey)).sort();
}

/**
 * ¿El paciente tiene algún ayuno vigente? (para el ícono de la tarjeta y el filtro)
 * Solo cuenta ocurrencias del minuto actual o futuras — las pasadas no marcan la cama.
 */
export function hasLiveFasting(fasting: Bed['fasting'] | undefined, now: number = Date.now()): boolean {
  if (!fasting?.indications?.length) return false;
  const nowKey = nowArtKey(now);
  return fasting.indications.some(i =>
    (i.occurrences ?? []).some(occ => isUpcomingOccurrence(occ, nowKey)));
}

/**
 * Ayunos de HOY (ART) AÚN VIGENTES, formateados "HH:MM", únicos y ordenados. Útil para
 * listados/PDFs "del día" — la API puede devolver ocurrencias de varios días (ver ejemplo
 * en api/ayunos.ts); acá filtramos solo las de la jornada ART actual y descartamos las
 * horas que ya pasaron.
 */
export function fastingTimesForToday(
  fasting: Bed['fasting'] | undefined,
  now: number = Date.now(),
): string[] {
  if (!fasting?.indications?.length) return [];
  // Y-M-D del "hoy" del usuario en ART (en-CA da formato YYYY-MM-DD).
  const todayYMD = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const nowKey = nowArtKey(now);

  const times = new Set<string>();
  for (const ind of fasting.indications) {
    for (const occ of ind.occurrences ?? []) {
      const p = parseArtParts(occ);
      if (!p) continue;
      if (`${p.Y}-${pad(p.M)}-${pad(p.D)}` !== todayYMD) continue;       // no es de hoy
      if (artKey(p.Y, p.M, p.D, p.h, p.min) < nowKey) continue;          // ya pasó hoy
      times.add(`${pad(p.h)}:${pad(p.min)}`);
    }
  }
  return Array.from(times).sort();
}
