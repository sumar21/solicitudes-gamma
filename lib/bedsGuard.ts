/**
 * Guard contra el mapa de camas PARCIAL de Gamma: un mapa NO vacío pero incompleto (algunos sectores sí,
 * otros no). Si el mapa nuevo se achica más de un 20% contra el anterior, se mantiene el anterior; si el
 * mapa chico se sostiene `acceptAfterMs` seguidos, se acepta (una baja real de camas no traba el mapa).
 *
 * Lo usa fetchBeds (hooks/useHospitalState.ts). /api/beds aplica la misma regla inline (api/ no importa
 * de lib/). Self-check: npx tsx scripts/check-beds-guard.mts
 */
export const BEDS_SHRINK_RATIO = 0.8;
export const BEDS_SHRINK_ACCEPT_MS = 3 * 60_000;

export interface ShrinkDecision {
  /** Usar el mapa nuevo. */
  accept: boolean;
  /** Desde cuándo viene llegando un mapa sospechosamente chico (null = no viene pasando). */
  since: number | null;
}

export function bedsShrinkDecision(
  prevCount: number, nextCount: number, since: number | null, now: number,
  acceptAfterMs = BEDS_SHRINK_ACCEPT_MS,
): ShrinkDecision {
  const suspicious = prevCount > 0 && nextCount < prevCount * BEDS_SHRINK_RATIO;
  if (!suspicious) return { accept: true, since: null };
  const start = since ?? now;
  return now - start >= acceptAfterMs ? { accept: true, since: null } : { accept: false, since: start };
}
