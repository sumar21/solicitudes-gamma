/**
 * Aprovisiona la lista SharePoint "14.Limpiezas" (limpiezas de habitaciones por azafatas)
 * con todas sus columnas e índices, vía Microsoft Graph. Idempotente: si la lista o una
 * columna ya existen, las saltea.
 *
 * Uso: npx tsx scripts/create-limpiezas-list.mts
 *
 * Al terminar imprime el LIST_ID nuevo → pegalo en api/limpiezas.ts (const LIST_ID).
 *
 * NOTA DE PERMISOS: crear listas/columnas requiere que la app de Azure tenga
 * Sites.Manage.All o Sites.FullControl.All. Si el app-registration solo tiene
 * Sites.ReadWrite.All, la creación devuelve 403 — en ese caso el script imprime la
 * especificación completa para crear la lista a mano desde la UI de SharePoint y
 * vuelve a correr para indexar. Todo lo que crea es metadata; no toca datos.
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
const LIST_NAME = '14.Limpiezas';
const { graphFetch } = await import('../api/graph.js');

// ── Especificación de columnas ────────────────────────────────────────────────
// Sufijo _L = "Limpiezas". Indexadas las que filtran las queries del endpoint.
type ColSpec = { name: string; index?: boolean; def: Record<string, unknown>; desc: string };
const TEXT = { text: {} };
const DATETIME = { dateTime: { displayAs: 'default', format: 'dateTime' } };
const CHOICE = (choices: string[]) => ({ choice: { choices, displayAs: 'dropDown' } });

const COLUMNS: ColSpec[] = [
  { name: 'CamaLabel_L',     index: true,  def: TEXT,                          desc: 'Label de la cama (join con el mapa) — ej. "Habitación 409 HPR - Cama 02"' },
  { name: 'CamaCodigo_L',    index: false, def: TEXT,                          desc: 'Código de cama Gamma (bedCode)' },
  { name: 'Habitacion_L',    index: false, def: TEXT,                          desc: 'Código de habitación Gamma (roomCode)' },
  { name: 'Area_L',          index: true,  def: TEXT,                          desc: 'Sector / piso (para filtrar por área de azafata)' },
  { name: 'Status_L',        index: true,  def: CHOICE(['Activo','Inactivo']), desc: 'Activo = overlay "Limpia" vigente; Inactivo = cerrada (soft-delete)' },
  { name: 'MotivoCierre_L',  index: false, def: CHOICE(['', 'ANULADA','TICKET','GAMMA']), desc: 'Por qué se cerró: ANULADA (azafata deshizo) / TICKET (traslado tomó la cama) / GAMMA (PROGAL avanzó)' },
  { name: 'AzafataId_L',     index: false, def: TEXT,                          desc: 'ID del usuario que marcó la limpieza' },
  { name: 'AzafataNombre_L', index: false, def: TEXT,                          desc: 'Nombre de la azafata (denormalizado para UI/auditoría)' },
  { name: 'FechaLimpieza_L', index: false, def: DATETIME,                      desc: 'Cuándo se marcó limpia (ISO)' },
  { name: 'FechaCierre_L',   index: false, def: DATETIME,                      desc: 'Cuándo se cerró (ISO)' },
  { name: 'Entorno_L',       index: true,  def: TEXT,                          desc: 'PRODUCTIVO / TESTING — separa entornos en la misma lista' },
];

function printManualSpec() {
  console.log('\n── Especificación para crear "14.Limpiezas" a mano (SharePoint → Listas → Nueva) ──');
  console.log('Columnas (además de Title, que ya viene): cada item lleva Title = "[sumar]".');
  for (const c of COLUMNS) {
    const tipo = 'text' in c.def ? 'Texto'
      : 'dateTime' in c.def ? 'Fecha y hora'
      : 'choice' in c.def ? `Opción [${(c.def as any).choice.choices.join(', ')}]`
      : '???';
    console.log(`  • ${c.name.padEnd(16)} ${tipo.padEnd(28)} ${c.index ? '[INDEXAR] ' : ''}— ${c.desc}`);
  }
  console.log('\nLuego volvé a correr este script para indexar las columnas marcadas [INDEXAR].');
}

if (!SITE_ID) { console.error('Falta SHAREPOINT_SITE_ID en .env.local'); process.exit(1); }

// ── 1) ¿Ya existe la lista? ───────────────────────────────────────────────────
let listId = '';
{
  const r = await graphFetch(`/sites/${SITE_ID}/lists?$select=id,displayName&$top=200`);
  if (r.ok) {
    const data = (await r.json()) as { value: { id: string; displayName: string }[] };
    const found = (data.value ?? []).find(l => l.displayName === LIST_NAME);
    if (found) { listId = found.id; console.log(`Lista "${LIST_NAME}" ya existe → ${listId}`); }
  } else {
    console.error('No pude listar las listas del sitio:', r.status, (await r.text()).slice(0, 200));
    process.exit(1);
  }
}

// ── 2) Crear la lista si falta ────────────────────────────────────────────────
if (!listId) {
  console.log(`Creando lista "${LIST_NAME}"…`);
  const r = await graphFetch(`/sites/${SITE_ID}/lists`, {
    method: 'POST',
    body: JSON.stringify({ displayName: LIST_NAME, list: { template: 'genericList' } }),
  });
  if (r.ok) {
    listId = String(((await r.json()) as { id: string }).id);
    console.log(`Lista creada → ${listId}`);
  } else {
    console.error(`No pude crear la lista (${r.status}): ${(await r.text()).slice(0, 300)}`);
    printManualSpec();
    process.exit(1);
  }
}

// ── 3) Crear columnas faltantes ───────────────────────────────────────────────
const existingCols = await (async () => {
  const r = await graphFetch(`/sites/${SITE_ID}/lists/${listId}/columns?$select=id,name,indexed`);
  if (!r.ok) { console.error('No pude listar columnas:', r.status); process.exit(1); }
  return ((await r.json()) as { value: { id: string; name: string; indexed?: boolean }[] }).value ?? [];
})();

for (const col of COLUMNS) {
  if (existingCols.some(c => c.name === col.name)) { console.log(`   ${col.name.padEnd(16)} → ya existe`); continue; }
  const r = await graphFetch(`/sites/${SITE_ID}/lists/${listId}/columns`, {
    method: 'POST',
    body: JSON.stringify({ name: col.name, description: col.desc, ...col.def }),
  });
  if (r.ok) console.log(`   ${col.name.padEnd(16)} → CREADA ✓`);
  else console.log(`   ${col.name.padEnd(16)} → FALLÓ (${r.status}): ${(await r.text()).slice(0, 160)}`);
}

// ── 4) Indexar columnas de filtro ─────────────────────────────────────────────
const colsNow = await (async () => {
  const r = await graphFetch(`/sites/${SITE_ID}/lists/${listId}/columns?$select=id,name,indexed`);
  return r.ok ? ((await r.json()) as { value: { id: string; name: string; indexed?: boolean }[] }).value ?? [] : [];
})();

for (const col of COLUMNS.filter(c => c.index)) {
  const live = colsNow.find(c => c.name === col.name);
  if (!live) { console.log(`   idx ${col.name.padEnd(16)} → no encontrada`); continue; }
  if (live.indexed) { console.log(`   idx ${col.name.padEnd(16)} → ya indexada`); continue; }
  const r = await graphFetch(`/sites/${SITE_ID}/lists/${listId}/columns/${live.id}`, {
    method: 'PATCH', body: JSON.stringify({ indexed: true }),
  });
  console.log(`   idx ${col.name.padEnd(16)} → ${r.ok ? 'INDEXADA ✓' : `FALLÓ (${r.status})`}`);
}

console.log(`\n✅ Listo. Pegá este LIST_ID en api/limpiezas.ts:\n   const LIST_ID = '${listId}'; // 14.Limpiezas`);
