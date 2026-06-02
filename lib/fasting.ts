/**
 * Cálculo de ocurrencias de ayuno en tiempo real, client-side, en hora Argentina.
 *
 * Por qué client-side: las "próximas" precalculadas por el cron quedan congeladas al
 * momento del cron (no sirven para "ocultar las que ya pasaron"), y además el cron corre
 * en Vercel (UTC) — calcular ahí con setHours interpretaba las horas de Gamma (que son
 * hora Argentina) como UTC, corriendo todo 3hs. Recalcular acá con el `now` del cliente
 * y offset ART fijo resuelve ambas cosas.
 *
 * Argentina = UTC-3 fijo (no tiene DST). Los timestamps se construyen con Date.UTC
 * (que normaliza overflow de hora/día) y se muestran con timeZone explícito.
 */

import type { Bed } from '../types';

const ART_OFFSET_H = 3;          // UTC-3
const GRACE_MS = 60 * 60 * 1000; // una ocurrencia sigue "vigente" 1h (la de las 15 se ve hasta las 16)

type Indication = { startISO: string; hours: number[]; totalOccurrences: number | null };

// Gamma manda PEA_FECHA_HORA_INICIO naive ("2026-05-28T09:57:00") = hora Argentina.
// Lo parseamos por partes para NO depender de la TZ del runtime (new Date lo haría).
function parseArtParts(iso: string): { Y: number; M: number; D: number; h: number; min: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return { Y: +m[1], M: +m[2], D: +m[3], h: +m[4], min: +m[5] };
}

/**
 * Epochs (ms UTC) de las ocurrencias de una indicación, en orden cronológico, en hora
 * Argentina. Empieza el día de startISO, cicla por las horas día a día, descarta las
 * anteriores al inicio, hasta llegar a `total` (o un ciclo si total es null).
 */
export function fastingOccurrenceEpochs(startISO: string, hours: number[], total: number | null): number[] {
  if (!hours.length) return [];
  const p = parseArtParts(startISO);
  if (!p) return [];

  const startEpoch = Date.UTC(p.Y, p.M - 1, p.D, p.h + ART_OFFSET_H, p.min, 0);
  const sortedHours = [...hours].sort((a, b) => a - b);
  const effectiveTotal = total ?? sortedHours.length;
  const maxDays = total === null ? 1 : 365;

  const out: number[] = [];
  for (let d = 0; out.length < effectiveTotal && d < maxDays; d++) {
    for (const H of sortedHours) {
      const epoch = Date.UTC(p.Y, p.M - 1, p.D + d, H + ART_OFFSET_H, 0, 0);
      if (epoch < startEpoch) continue;
      out.push(epoch);
      if (out.length >= effectiveTotal) break;
    }
  }
  return out;
}

/** Próximas ocurrencias vigentes/futuras de una indicación (con gracia de 1h). */
export function liveUpcoming(ind: Indication, now: number = Date.now(), max = 5): number[] {
  return fastingOccurrenceEpochs(ind.startISO, ind.hours, ind.totalOccurrences)
    .filter(e => e + GRACE_MS > now)
    .slice(0, max);
}

/** ¿El paciente tiene algún ayuno vigente o por venir? (para el ícono de la tarjeta) */
export function hasLiveFasting(fasting: Bed['fasting'] | undefined, now: number = Date.now()): boolean {
  if (!fasting?.indications?.length) return false;
  return fasting.indications.some(i => liveUpcoming(i, now, 1).length > 0);
}

/** Formatea un epoch en hora Argentina (robusto ante la TZ del dispositivo). */
export function formatART(epochMs: number): string {
  return new Date(epochMs).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false,  // 24h para coincidir con el header "Horas: HH:00" del modal
  });
}

/**
 * Horas únicas de ayuno (en ART) programadas para HOY, ordenadas asc. Útil para
 * listados/PDFs "del día" — distinto de `liveUpcoming` que solo mira lo que está
 * por venir desde ahora. Acá tomamos TODA la jornada ART [00:00, 24:00).
 *
 * Ejemplo: si Gamma manda una indicación con `hours=[10,12,18]` y otra con `[10,15]`,
 * ambas para hoy → devuelve `[10, 12, 15, 18]`. Ocurrencias de otros días se descartan.
 */
export function fastingHoursForToday(
  fasting: Bed['fasting'] | undefined,
  now: number = Date.now(),
): number[] {
  if (!fasting?.indications?.length) return [];
  // Inicio del día ART (00:00 ART = 03:00 UTC del mismo día calendario ART).
  // Usamos toLocaleDateString con timeZone para obtener Y-M-D del "hoy" del usuario.
  const artYMD = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(artYMD);
  if (!m) return [];
  const [, Y, M, D] = m;
  const dayStart = Date.UTC(+Y, +M - 1, +D, ART_OFFSET_H, 0, 0);
  const dayEnd   = dayStart + 24 * 60 * 60 * 1000;

  const horas = new Set<number>();
  for (const ind of fasting.indications) {
    const occs = fastingOccurrenceEpochs(ind.startISO, ind.hours, ind.totalOccurrences);
    for (const epoch of occs) {
      if (epoch >= dayStart && epoch < dayEnd) {
        // Recuperar la hora ART del epoch (UTC - 3, normalizado mod 24).
        const artHour = (new Date(epoch).getUTCHours() - ART_OFFSET_H + 24) % 24;
        horas.add(artHour);
      }
    }
  }
  return Array.from(horas).sort((a, b) => a - b);
}
