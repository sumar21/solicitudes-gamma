/**
 * Catálogo de aislamientos con REGLA DE CONVIVENCIA + sigla de cartelería.
 *
 * El nombre canónico y el color los define el back (`api/isolations-summary.ts`, que normaliza
 * lo que manda PROGAL). Acá vive lo que el back no sabe: con quién puede compartir habitación
 * cada aislamiento, y qué sigla lleva el cartel de la puerta. Se matchea por nombre canónico
 * normalizado para no acoplarse al string exacto de Gamma.
 *
 * Alta de aislamientos QUEMADO / DIÁLISIS PERITONEAL (mail HPR 16/09/2026, POE 1698 y 1673):
 *   · Quemado (Q)             → SOLO comparte habitación con otro Quemado.
 *   · Diálisis peritoneal (DP) → NO comparte habitación con nadie.
 * Ambos con cartelería verde inglés (color `englishGreen`).
 */
import { Bed, BedStatus } from '../types';

/** Con quién puede compartir habitación un paciente con este aislamiento. */
export type SharingRule =
  | 'solo'   // no comparte con nadie (DP)
  | 'igual'  // solo con otro paciente del MISMO aislamiento (Q)
  | 'libre'; // sin regla propia de convivencia (el resto)

interface IsolationRule {
  sigla: string;
  rule: SharingRule;
}

// Clave = fragmento del nombre canónico ya normalizado (sin tildes, minúsculas). Se usa
// `includes` para tolerar variantes de PROGAL ("Quemado" / "Quemados").
const ISOLATION_RULES: [match: string, meta: IsolationRule][] = [
  ['dialisis peritoneal', { sigla: 'DP', rule: 'solo'  }],
  ['quemado',             { sigla: 'Q',  rule: 'igual' }],
];

/** Normalización determinística — mismo criterio que `api/isolations-summary.ts`. */
const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function lookup(isolationName: string): IsolationRule | undefined {
  const n = norm(isolationName);
  return ISOLATION_RULES.find(([match]) => n.includes(match))?.[1];
}

/** Sigla de cartelería (Q, DP). `undefined` para los aislamientos que no tienen uno oficial. */
export function isolationSigla(isolationName: string): string | undefined {
  return lookup(isolationName)?.sigla;
}

/** Regla de convivencia de un aislamiento. Los que no están en el catálogo son 'libre'. */
export function isolationRule(isolationName: string): SharingRule {
  return lookup(isolationName)?.rule ?? 'libre';
}

/** Aislamientos de una cama que imponen una regla de convivencia propia. */
function restrictiveIsolations(bed: Bed | undefined): { name: string; rule: SharingRule }[] {
  return (bed?.isolations ?? [])
    .map(i => ({ name: i.name, rule: isolationRule(i.name) }))
    .filter(i => i.rule !== 'libre');
}

/** ¿La cama `b` tiene un aislamiento cuyo nombre canónico matchea el de `name`? */
function hasSameIsolation(bed: Bed, name: string): boolean {
  const target = norm(name);
  return (bed.isolations ?? []).some(i => norm(i.name) === target);
}

/**
 * Ocupantes REALES de la habitación de `destBed`, sin contar la cama destino.
 *
 * Habitación = mismo `roomCode` + misma `area` (mismo criterio que `roomSexConflict`).
 * Ocupante = `status === OCCUPIED`: NO se usa `patientName` porque en este repo queda residual
 * en camas ya liberadas (ver la nota larga de `suggestedRoomSex` en lib/utils.ts) y un paciente
 * fantasma bloquearía una habitación vacía.
 */
function roommatesOf(beds: Bed[], destBed: Bed): Bed[] {
  if (!destBed.roomCode) return [];
  return beds.filter(b =>
    b.label !== destBed.label &&
    b.roomCode === destBed.roomCode &&
    b.area === destBed.area &&
    b.status === BedStatus.OCCUPIED,
  );
}

export interface IsolationConflict {
  /** Texto listo para mostrar, explica por qué esa habitación no sirve. */
  reason: string;
  /** Ocupantes actuales de la habitación destino que motivan el conflicto. */
  roommates: Bed[];
}

/**
 * ¿Mover al paciente de `originLabel` a la cama `destLabel` rompe una regla de convivencia?
 *
 * Mira los DOS lados, porque la regla es simétrica:
 *   · el que se mueve (p. ej. un DP no puede entrar a una habitación ocupada), y
 *   · los que ya están (p. ej. no se puede meter a nadie con un DP ya internado).
 *
 * Devuelve `null` si no hay conflicto. Best-effort: los aislamientos vienen del enrich (cron
 * cada 15 min), así que un dato viejo puede no reflejar la última indicación de PROGAL.
 */
export function roomIsolationConflict(
  beds: Bed[],
  originLabel: string,
  destLabel: string,
): IsolationConflict | null {
  const patientBed = beds.find(b => b.label === originLabel);
  const destBed = beds.find(b => b.label === destLabel);
  if (!patientBed || !destBed) return null;

  const roommates = roommatesOf(beds, destBed);
  if (roommates.length === 0) return null; // habitación vacía: ninguna regla aplica

  const who = (bs: Bed[]) => bs.map(b => `${b.label} — ${b.patientName || 'sin nombre'}`).join(', ');

  // ── Lado 1: el paciente que se traslada ──────────────────────────────────
  for (const iso of restrictiveIsolations(patientBed)) {
    if (iso.rule === 'solo') {
      return {
        reason: `El paciente tiene ${iso.name} (${isolationSigla(iso.name)}): no puede compartir habitación. La habitación destino ya está ocupada por ${who(roommates)}.`,
        roommates,
      };
    }
    if (iso.rule === 'igual') {
      const distintos = roommates.filter(b => !hasSameIsolation(b, iso.name));
      if (distintos.length) {
        return {
          reason: `El paciente tiene ${iso.name} (${isolationSigla(iso.name)}): solo puede compartir habitación con otro paciente igual. En la habitación destino hay ${who(distintos)}.`,
          roommates: distintos,
        };
      }
    }
  }

  // ── Lado 2: los que ya están en la habitación ────────────────────────────
  for (const mate of roommates) {
    for (const iso of restrictiveIsolations(mate)) {
      if (iso.rule === 'solo') {
        return {
          reason: `${mate.label} — ${mate.patientName || 'sin nombre'} tiene ${iso.name} (${isolationSigla(iso.name)}): no comparte habitación.`,
          roommates: [mate],
        };
      }
      if (iso.rule === 'igual' && !hasSameIsolation(patientBed, iso.name)) {
        return {
          reason: `${mate.label} — ${mate.patientName || 'sin nombre'} tiene ${iso.name} (${isolationSigla(iso.name)}): solo comparte habitación con otro paciente igual.`,
          roommates: [mate],
        };
      }
    }
  }

  return null;
}

/**
 * Parte la lista de destinos posibles en los que respetan las reglas de convivencia y los que
 * no. La usan los tres modales que eligen destino (alta, edición y configuración de pre-ticket).
 *
 * `keepLabel` es el destino YA elegido del ticket que se está editando: nunca se excluye, para
 * no dejar un select apuntando a una opción inexistente.
 *
 * Sin `originLabel` (todavía no eligieron paciente) no se filtra nada.
 */
export function splitDestinationsByIsolation(
  beds: Bed[],
  originLabel: string | undefined,
  destinations: Bed[],
  keepLabel?: string | null,
): { allowed: Bed[]; blocked: { bed: Bed; conflict: IsolationConflict }[] } {
  if (!originLabel) return { allowed: destinations, blocked: [] };
  const allowed: Bed[] = [];
  const blocked: { bed: Bed; conflict: IsolationConflict }[] = [];
  for (const bed of destinations) {
    const conflict = bed.label === keepLabel ? null : roomIsolationConflict(beds, originLabel, bed.label);
    if (conflict) blocked.push({ bed, conflict });
    else allowed.push(bed);
  }
  return { allowed, blocked };
}
