/**
 * Read-only: prueba en vivo que la app NO puede consultar por el nombre que ves en la UI
 * (CamaLabel_D) porque el nombre interno real es field_1. No modifica nada.
 * Uso: npx tsx scripts/probe-dietas-names.mts
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
const { graphFetch } = await import('../api/graph.js');

const lr = await graphFetch(`/sites/${SITE_ID}/lists?$select=id,displayName&$top=200`);
const list = (((await lr.json()) as any).value ?? []).find((l: any) => l.displayName === '15.CargaComandas');
if (!list) { console.error('No encuentro la lista 15.CargaComandas'); process.exit(1); }
const base = `/sites/${SITE_ID}/lists/${list.id}/items`;
const hdr = { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' };

async function tryFilter(fieldName: string) {
  const url = `${base}?$expand=fields&$filter=${encodeURIComponent(`fields/${fieldName} eq 'zzz'`)}&$top=1`;
  const r = await graphFetch(url, { headers: hdr });
  const body = await r.text();
  return { status: r.status, ok: r.ok, msg: body.slice(0, 220) };
}

console.log('\n① La consulta que hace la app  → filtrar por  fields/CamaLabel_D  (el nombre que VES)');
const a = await tryFilter('CamaLabel_D');
console.log(`   HTTP ${a.status} ${a.ok ? 'OK' : '❌ ERROR'}`);
console.log(`   ${a.msg}\n`);

console.log('② La misma consulta pero por el nombre INTERNO real → fields/field_1');
const b = await tryFilter('field_1');
console.log(`   HTTP ${b.status} ${b.ok ? '✅ OK (existe)' : 'ERROR'}`);
console.log(`   ${b.msg}\n`);

console.log('Conclusión: la columna que ves como "CamaLabel_D" existe internamente como "field_1".');
console.log('La app pregunta por "CamaLabel_D" → no existe → nunca lee ni guarda nada ahí.');
