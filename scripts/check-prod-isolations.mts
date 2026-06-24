/**
 * Diagnóstico read-only: cuenta cuántas filas de 12.EnrichCamas (por entorno) ya
 * tienen `isolations` en su Payload_EC. Sirve para confirmar que el cron (con el
 * código nuevo) está persistiendo los aislamientos en SharePoint.
 *
 * Uso: npx tsx scripts/check-prod-isolations.mts
 * NO escribe nada. Borrable.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── .env.local (para AZURE_* + SHAREPOINT_SITE_ID) ───────────────────────────
try {
  const envPath = resolve(import.meta.dirname ?? '.', '..', '.env.local');
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq < 0) continue;
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch (e: any) { console.error('No pude cargar .env.local:', e.message); process.exit(1); }

const SITE_ID = process.env.SHAREPOINT_SITE_ID ?? '';
const LIST_ID = '443c4ff0-bc98-43ef-a49c-7fd91cc63734'; // 12.EnrichCamas

// Import dinámico DESPUÉS de cargar el env (graph.ts lee AZURE_* al evaluarse).
const { graphFetch } = await import('../api/graph.js');

async function checkEntorno(entorno: string) {
  const filter = encodeURIComponent(`fields/Status_EC eq 'Activo' and fields/Entorno_EC eq '${entorno}'`);
  const r = await graphFetch(
    `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$filter=${filter}&$top=500`,
    { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
  );
  if (!r.ok) { console.error(`[${entorno}] Graph error ${r.status}:`, (await r.text()).slice(0, 200)); return; }
  const data = (await r.json()) as { value: any[] };
  const rows = data.value ?? [];

  let withIso = 0;
  let latest = '';
  const samples: string[] = [];
  for (const item of rows) {
    const f = item.fields ?? {};
    const updated = String(f.UpdatedAt_EC ?? '');
    if (updated > latest) latest = updated;
    let payload: any = {};
    try { payload = JSON.parse(String(f.Payload_EC ?? '{}')); } catch { /* fila corrupta */ }
    const iso = payload?.isolations;
    if (Array.isArray(iso) && iso.length > 0) {
      withIso++;
      if (samples.length < 5) {
        const names = iso.map((x: any) => `${x.name}${x.observation ? ' (+obs)' : ''}`).join(', ');
        samples.push(`   · ${f.EventKey_EC} → ${names}`);
      }
    }
  }

  console.log(`\n=== ${entorno} ===`);
  console.log(`Filas activas: ${rows.length} | con isolations en payload: ${withIso} | UpdatedAt más reciente: ${latest || '—'}`);
  if (samples.length) { console.log('Ejemplos:'); samples.forEach(s => console.log(s)); }
}

await checkEntorno('PRODUCTIVO');
await checkEntorno('TESTING');
console.log();
