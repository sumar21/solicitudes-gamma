/**
 * Read-only: inspecciona la lista "15.CargasDieta" en SharePoint y valida el tipo de cada
 * columna contra lo que espera api/dietas.ts. No modifica nada. Uso: npx tsx scripts/inspect-dietas-list.mts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const envPath = resolve(import.meta.dirname ?? '.', '..', '.env.local');
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq < 0) continue;
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch (e: any) { console.error('No .env.local:', e.message); process.exit(1); }

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_NAME = '15.CargaComandas';
const { graphFetch } = await import('../api/graph.js');

// Tipo RECOMENDADO por columna (columna informativa). La app escribe strings y lee
// String(f...), así que a nivel funcional cualquier tipo que guarde texto sirve
// (text / text-multiline / choice / dateTime). Lo ÚNICO que rompe el guardado es
// Número o Sí/No (rechazan el string vacío que la app puede mandar).
const EXPECTED: Record<string, string> = {
  CamaLabel_D: 'text', CamaCodigo_D: 'text', Habitacion_D: 'text', Area_D: 'text',
  PacienteNombre_D: 'text', PacienteCodigo_D: 'text',
  Comida_D: 'text', Tipo_D: 'text', Status_D: 'text',
  Observaciones_D: 'text-multiline',
  NutricionistaID_D: 'number', NutricionistaNombre_D: 'text',  // ID mayúscula: la app la escribe como número
  FechaCarga_D: 'dateTime', FechaCierre_D: 'dateTime',
  Entorno_D: 'text',
};
const BREAKS = new Set(['number', 'boolean']); // tipos que rompen el guardado de strings

function typeOf(col: any): string {
  if (col.choice)   return 'choice';
  if (col.dateTime) return 'dateTime';
  if (col.number)   return 'number';
  if (col.boolean)  return 'boolean';
  if (col.text)     return col.text.allowMultipleLines ? 'text-multiline' : 'text';
  return Object.keys(col).find(k => typeof col[k] === 'object' && !['0'].includes(k)) ?? '(desconocido)';
}

if (!SITE_ID) { console.error('Falta SHAREPOINT_SITE_ID en .env.local'); process.exit(1); }

// 1) Buscar la lista
const lr = await graphFetch(`/sites/${SITE_ID}/lists?$select=id,displayName&$top=200`);
if (!lr.ok) { console.error('No pude listar listas:', lr.status, (await lr.text()).slice(0, 200)); process.exit(1); }
const lists = ((await lr.json()) as any).value ?? [];
const list = lists.find((l: any) => l.displayName === LIST_NAME);
if (!list) { console.error(`❌ No existe la lista "${LIST_NAME}". Listas: ${lists.map((l: any) => l.displayName).join(', ')}`); process.exit(1); }
console.log(`✅ Lista "${LIST_NAME}" → LIST_ID = ${list.id}\n`);

// 2) Columnas
const cr = await graphFetch(`/sites/${SITE_ID}/lists/${list.id}/columns`);
if (!cr.ok) { console.error('No pude listar columnas:', cr.status); process.exit(1); }
const cols = ((await cr.json()) as any).value ?? [];
const byName = new Map<string, any>(cols.map((c: any) => [c.name, c]));

console.log('Columna                  | Tipo actual      | Esperado         | Idx | Estado');
console.log('-------------------------|------------------|------------------|-----|-------');
let problems = 0;
for (const [name, exp] of Object.entries(EXPECTED)) {
  const col = byName.get(name);
  if (!col) { console.log(`${name.padEnd(24)} | ${'(NO EXISTE)'.padEnd(16)} | ${exp.padEnd(16)} |     | ❌ FALTA / nombre interno distinto`); problems++; continue; }
  const actual = typeOf(col);
  const idx = col.indexed ? ' ✓ ' : '   ';
  // La app escribe strings a casi todo (text/choice/dateTime/multiline son equivalentes);
  // la única que escribe como número es NutricionistaID_D (exp='number'). Entonces: si se
  // espera número, debe ser número; para el resto, Número/Sí-No rompe el guardado.
  const ok = exp === 'number' ? actual === 'number' : !BREAKS.has(actual);
  const estado = ok ? '✅' : '❌ CAMBIAR (rompe el guardado)';
  if (!ok) problems++;
  console.log(`${name.padEnd(24)} | ${actual.padEnd(16)} | ${exp.padEnd(16)} |${idx}| ${estado}`);
  if (actual === 'choice' && col.choice?.choices) console.log(`   └─ choices: [${col.choice.choices.join(', ')}]`);
}

// 3) Columnas extra (creadas por el import y no esperadas)
const extras = cols.filter((c: any) => !EXPECTED[c.name] && !c.readOnly && c.name !== 'Title' && !c.name.startsWith('_') && c.name !== 'LinkTitle' && c.name !== 'Attachments' && c.columnGroup !== '_Hidden');
if (extras.length) {
  console.log(`\nColumnas creadas por el import (nombre interno → display · tipo):`);
  for (const c of extras) console.log(`   ${String(c.name).padEnd(10)} → ${String(c.displayName).padEnd(24)} · ${typeOf(c)}`);
}

console.log(problems === 0
  ? '\n✅ Todo OK (ninguna columna es Número/Sí-No). Pegá el LIST_ID de arriba en DIETAS_LIST_ID.'
  : `\n❌ ${problems} columna(s) tipo Número/Sí-No → rompen el guardado. Cambialas a Texto (ver arriba).`);
