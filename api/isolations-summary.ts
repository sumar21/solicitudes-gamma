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

// Import SOLO de tipo: este módulo es lógica pura de normalización y no debe arrastrar el
// side-effect de gamma-client (que aborta si falta GAMMA_VM_URL) — así lo puede importar el
// self-check de scripts/check-isolation-sharing.mts sin credenciales de PROGAL.
import type { GammaEvent } from './gamma-client.js';

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
  // Alta 16/09/2026 (mail HPR, POE 1698 y 1673). Cartelería verde inglés con sigla Q / DP.
  // Las reglas de convivencia viven en lib/isolations.ts (el back solo nombra y colorea).
  'quemados':                 { name: 'Quemado',             color: 'englishGreen' },
  'quemado':                  { name: 'Quemado',             color: 'englishGreen' },
  'dialisis peritoneal':      { name: 'Diálisis peritoneal', color: 'englishGreen' },
};

// PROGAL todavía no publicó el nombre EXACTO de los dos aislamientos nuevos (sale a producción
// el 21/09/2026). Estos patrones los reconocen igual si vienen como 'Quemados', 'Quemado',
// 'Diálisis Peritoneal', etc. — sin esto caerían al default violeta y perderían su regla.
const FUZZY_TYPES: [RegExp, { name: string; color: string }][] = [
  [/dialisis\s*peritoneal/, { name: 'Diálisis peritoneal', color: 'englishGreen' }],
  [/quemad/,                 { name: 'Quemado',             color: 'englishGreen' }],
];

// Mientras PROGAL no tenga la indicación propia, el hospital escribe 'Q' o 'DP' en las
// OBSERVACIONES de un aislamiento de contacto / contacto preventivo (mail HPR 16/09/2026).
// Estos patrones los rescatan de ahí para que la app aplique la regla desde ya.
//
// La SIGLA se busca en MAYÚSCULA sobre el texto crudo y con límite de palabra: una 'q' suelta
// en minúscula es abreviatura de "que" en texto libre ("avisar q se va") y daría un falso
// positivo clínico. La palabra completa sí se acepta en cualquier casing (se testea normalizada).
const OBSERVATION_MARKERS: { sigla: RegExp; word: RegExp; meta: { name: string; color: string } }[] = [
  { sigla: /(^|[^A-Za-z])DP([^A-Za-z]|$)/, word: /dialisis\s*peritoneal/, meta: { name: 'Diálisis peritoneal', color: 'englishGreen' } },
  { sigla: /(^|[^A-Za-z])Q([^A-Za-z]|$)/,  word: /quemad[oa]s?/,          meta: { name: 'Quemado',             color: 'englishGreen' } },
];

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
      const fuzzy = FUZZY_TYPES.find(([re]) => re.test(n))?.[1];
      const mapped = ISOLATION_MAP[n] ?? fuzzy ?? { name: desc.trim(), color: 'violet' };
      actives.set(n, mapped); // para un tipo base, n === su clave base
    }
  }
  if (actives.size === 0) return undefined;

  const entries: IsolationEntry[] = [];
  for (const [key, { name, color }] of actives) {
    const observation = observations.get(key);
    entries.push(observation ? { name, color, observation } : { name, color });
  }
  // Q / DP escritos a mano en las observaciones: se agregan como aislamiento propio si PROGAL
  // todavía no los manda como tipo. Idempotente — si ya vinieron como tipo, no se duplican.
  for (const text of observations.values()) {
    const t = norm(text);
    for (const { sigla, word, meta } of OBSERVATION_MARKERS) {
      if (!sigla.test(text) && !word.test(t)) continue;
      if (entries.some(e => e.name === meta.name)) continue;
      entries.push({ ...meta, observation: `Derivado de la observación: "${text}"` });
    }
  }

  // Orden estable por nombre → hash determinístico y color "primario" consistente.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}
