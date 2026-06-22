/**
 * Procesamiento del campo AISLAMIENTOS[] del evento Gamma (obtenereventointernacion).
 *
 * Desde jun-2026 Gamma devuelve los aislamientos prescriptos al paciente con la MISMA
 * forma que DIETAS: cada fila tiene una pregunta (HCG_DESCRIPCION) y su respuesta
 * (EIP_RESPUESTA_VALOR). Validado contra producción (scripts/probe-isolations.mts):
 *   · El tipo base trae EIP_RESPUESTA_VALOR === "Prescribe". Gamma NO manda "Ninguno":
 *     solo incluye lo prescripto. Igual lo tratamos defensivamente.
 *   · La observación llega como una fila aparte "<Tipo> - Observaciones" con el texto
 *     libre en EIP_RESPUESTA_VALOR (ej. "influenza A+", "Portador MBL").
 *
 * Acá normalizamos el nombre de Gamma a un nombre canónico + clave de color (la app
 * los nombra distinto: "De contacto" → "Contacto", "COVID 19" → "Covid", etc.) y
 * adjuntamos la observación. Reemplaza la carga manual de aislamientos (lista
 * 08.Aislamientos): desde esta migración la fuente única es PROGAL.
 */

import { simpleHash, type GammaEvent } from './gamma-client.js';

export interface IsolationEntry {
  name: string;          // nombre canónico para mostrar
  color: string;         // clave de color semántica (el front la mapea a clases Tailwind)
  observation?: string;  // texto libre de la fila "<Tipo> - Observaciones"
}

// Gamma HCG_DESCRIPCION (normalizado) → { nombre canónico, color }.
// Validado sobre el universo de camas ocupadas (probe jun-2026): 0 desconocidos.
const ISOLATION_MAP: Record<string, { name: string; color: string }> = {
  'respiratorio':             { name: 'Respiratorio',        color: 'green'   },
  'neutropenico':             { name: 'Neutropénico',        color: 'pink'    },
  'trasplante':               { name: 'Trasplante',          color: 'slate'   },
  'por gotas':                { name: 'Por Gotas',           color: 'blue'    },
  'de contacto':              { name: 'Contacto',            color: 'orange'  },
  'de contacto preventivo':   { name: 'Contacto preventivo', color: 'teal'    },
  'de contacto c. difficile': { name: 'C. Difficile',        color: 'amber'   },
  'entomologico':             { name: 'Entomológico/Dengue', color: 'fuchsia' },
  'covid 19':                 { name: 'Covid',               color: 'yellow'  },
};

// Normalización determinística: NFD sin diacríticos + lower + colapsar espacios + trim.
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Quita el sufijo "- Observaciones" para obtener la clave base del tipo.
function baseKey(desc: string): string {
  return norm(desc).replace(/\s*-\s*observaci.*$/, '').trim();
}

/**
 * Arma la lista de aislamientos activos (con su observación) que persistimos en
 * 12.EnrichCamas y consume el front. Devuelve `undefined` cuando no hay aislamientos.
 */
export function summarizeIsolations(
  ais: GammaEvent['AISLAMIENTOS'] | undefined,
): IsolationEntry[] | undefined {
  if (!Array.isArray(ais) || ais.length === 0) return undefined;

  // Primera pasada: separar tipos prescriptos de sus observaciones (key = base normalizada).
  const actives = new Map<string, { name: string; color: string }>();
  const observations = new Map<string, string>();

  for (const row of ais) {
    const desc = String(row?.HCG_DESCRIPCION ?? '');
    const value = String(row?.EIP_RESPUESTA_VALOR ?? '').trim();
    if (!desc) continue;
    const n = norm(desc);
    if (n.includes('observ')) {
      if (value) observations.set(baseKey(desc), value);
    } else {
      // Fila de tipo base. Gamma solo manda lo prescripto; si algún día mandara
      // "Ninguno" lo ignoramos defensivamente.
      if (norm(value) === 'ninguno') continue;
      // Default si Gamma agrega un tipo que todavía no mapeamos: no se pierde, cae a violet.
      const mapped = ISOLATION_MAP[n] ?? { name: desc.trim(), color: 'violet' };
      actives.set(n, mapped); // para un tipo base, n === su clave base
    }
  }
  if (actives.size === 0) return undefined;

  const entries: IsolationEntry[] = [];
  for (const [key, { name, color }] of actives) {
    const observation = observations.get(key);
    entries.push(observation ? { name, color, observation } : { name, color });
  }
  // Orden estable por nombre → hash determinístico y color "primario" consistente.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/**
 * Hash estable del estado de aislamientos (análogo a fastingHash / hashDietTags) para
 * detectar cambios entre corridas del cron. 'none' cuando no hay aislamientos.
 */
export function hashIsolations(entries: IsolationEntry[] | undefined | null): string {
  if (!entries || entries.length === 0) return 'none';
  const sig = entries
    .map(e => `${e.name}:${e.observation ?? ''}`)
    .sort()
    .join('|');
  return simpleHash(sig);
}
