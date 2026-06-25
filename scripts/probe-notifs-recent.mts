/**
 * Probe read-only: replica la lógica EXACTA de api/notifications.ts (?window=24h) — paginar con
 * $orderby Fecha desc hasta MAX_SCAN y recortar 24h en memoria — y la compara con la misma sin
 * $orderby. Muestra cuántas filas trae cada una y cuántas caen dentro de 24h/48h, más la Fecha
 * más nueva devuelta. Si la variante con $orderby trae menos y se pierde las recientes → confirma
 * que el list-view threshold sobre columnas no indexadas rompe la campanita.
 *
 * Uso: ENTORNO=PRODUCTIVO npx tsx scripts/probe-notifs-recent.mts <userId>
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
const LIST_ID = '240f00dd-715b-4c78-9661-3147b7650a0f';
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();
const USER = process.argv[2] ?? '44';
const { graphFetch } = await import('../api/graph.js');
const base = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;
const MAX_SCAN = 5000;
const f = encodeURIComponent(`fields/UserId_N eq ${USER} and fields/Entorno_N eq '${ENTORNO}'`);

async function pull(withOrderby: boolean) {
  const rows: any[] = [];
  let next: string | null = `${base}?$expand=fields&$filter=${f}&$top=500${withOrderby ? '&$orderby=fields/Fecha_N desc' : ''}`;
  let pages = 0;
  while (next && rows.length < MAX_SCAN) {
    const r: any = await graphFetch(next, { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } as any });
    if (!r.ok) { console.log(`   page ${pages} HTTP ${r.status}`); break; }
    const d: any = await r.json();
    for (const it of d.value ?? []) rows.push(it);
    pages++;
    const raw = d['@odata.nextLink'] as string | undefined;
    next = raw ? raw.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
  }
  const times = rows.map(it => new Date(String((it.fields ?? {}).Fecha_N ?? '')).getTime()).filter(Number.isFinite);
  const now = Date.now();
  const in24 = times.filter(t => t >= now - 24 * 3600e3).length;
  const in48 = times.filter(t => t >= now - 48 * 3600e3).length;
  const max = times.length ? new Date(Math.max(...times)).toISOString() : '—';
  const min = times.length ? new Date(Math.min(...times)).toISOString() : '—';
  return { count: rows.length, pages, in24, in48, max, min };
}

console.log(`ENTORNO=${ENTORNO} USER=${USER}\n`);
const withO = await pull(true);
console.log('CON $orderby (lo que usa la API HOY):', withO);
const noO = await pull(false);
console.log('SIN $orderby (paginado completo)     :', noO);
console.log(`\n→ La campanita 24h mostraría: CON orderby=${withO.in24} filas | SIN orderby=${noO.in24} filas`);
console.log();
