/**
 * Parser de DIETAS del evento Gamma → array completo + chips resumen.
 * Usado por /api/beds (enrich masivo) y /api/bed-enrich (modal on-click).
 *
 * Reglas (mismas de siempre):
 *   - "Tipo" (HCG_DESCRIPCION): se conserva su valor libre como chip ("Liviana", "Blanda")
 *     salvo que la respuesta sea "No".
 *   - Resto de condiciones: solo aparecen como chip si la respuesta es "Sí"/"Si".
 */

import type { GammaEvent } from './gamma-client.js';

export interface DietEntry {
  descripcion: string;  // HCG_DESCRIPCION
  respuesta: string;    // EIP_RESPUESTA_VALOR
}

// Normalización determinística (unicode NFC + colapsar espacios + trim).
// DEBE coincidir con normalizeTag en api/cron-diet-changes.ts: el cron hashea
// estos mismos tags para detectar cambios, así que la nomenclatura mostrada y la
// hasheada tienen que normalizarse igual o el hash "saltaría" sin cambio real.
function normalizeTag(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function parseDiets(
  dietas: GammaEvent['DIETAS'] | undefined,
): { diets?: DietEntry[]; dietTags?: string[] } {
  if (!Array.isArray(dietas) || dietas.length === 0) return {};

  const diets: DietEntry[] = dietas
    .filter(d => d?.HCG_DESCRIPCION)
    .map(d => ({
      descripcion: normalizeTag(String(d.HCG_DESCRIPCION ?? '')),
      respuesta:   normalizeTag(String(d.EIP_RESPUESTA_VALOR ?? '')),
    }));

  if (diets.length === 0) return {};

  const tags: string[] = [];
  for (const d of diets) {
    const resp = d.respuesta.toLowerCase();
    if (d.descripcion.toLowerCase() === 'tipo') {
      if (d.respuesta && resp !== 'no') tags.push(d.respuesta);
    } else if (resp === 'sí' || resp === 'si') {
      tags.push(d.descripcion);
    }
  }

  return { diets, dietTags: tags.length > 0 ? tags : undefined };
}
