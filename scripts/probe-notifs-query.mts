/**
 * Probe read-only: reproduce las queries EXACTAS de api/notifications.ts contra 10.Notificaciones
 * para confirmar si fallan por el list-view threshold (>5000 items) con $filter/$orderby sobre
 * columnas no indexadas. Reporta status HTTP + cantidad devuelta + error text por variante.
 *
 * Uso: npx tsx scripts/probe-notifs-query.mts [userId]
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
const LIST_ID = '240f00dd-715b-4c78-9661-3147b7650a0f'; // 10.Notificaciones
const ENTORNO = (process.env.ENTORNO ?? 'TESTING').trim();
const USER = process.argv[2] ?? '56';
const { graphFetch } = await import('../api/graph.js');
const base = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;
const H = { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } as any;

async function probe(label: string, url: string) {
  try {
    const r = await graphFetch(url, { headers: H });
    const text = await r.text();
    let count = -1;
    try { count = (JSON.parse(text).value ?? []).length; } catch { /* */ }
    console.log(`\n[${label}]`);
    console.log(`   status=${r.status} ok=${r.ok} count=${count}`);
    if (!r.ok) console.log(`   error=${text.slice(0, 300)}`);
  } catch (e: any) { console.log(`\n[${label}] THREW: ${e.message}`); }
}

console.log(`ENTORNO=${ENTORNO}  USER=${USER}  (probando 10.Notificaciones)`);

// 1. Total de la lista (getCount)
try {
  const r = await graphFetch(`/sites/${SITE_ID}/lists/${LIST_ID}?$select=id&$expand=items($select=id;$top=1)`, { headers: H });
  console.log(`\n[meta] list fetch status=${r.status}`);
} catch { /* */ }

const f = encodeURIComponent(`fields/UserId_N eq ${USER} and fields/Entorno_N eq '${ENTORNO}'`);
const fStatus = encodeURIComponent(`fields/UserId_N eq ${USER} and fields/Entorno_N eq '${ENTORNO}' and fields/Status_N eq 'Enviada'`);

// 2. EXACTA del banner (no-history): top 50 + orderby Fecha desc + filtro Status Enviada
await probe('banner GET (no window): $filter UserId+Entorno+Status + $orderby Fecha desc + $top=50',
  `${base}?$expand=fields&$filter=${fStatus}&$top=50&$orderby=fields/Fecha_N desc`);

// 3. EXACTA del historial 24h: $filter UserId+Entorno + $orderby Fecha desc + $top=500
await probe('history GET (?window=24h): $filter UserId+Entorno + $orderby Fecha desc + $top=500',
  `${base}?$expand=fields&$filter=${f}&$top=500&$orderby=fields/Fecha_N desc`);

// 4. Igual pero SIN $orderby (¿el orderby es el que rompe?)
await probe('history SIN $orderby: $filter UserId+Entorno + $top=500',
  `${base}?$expand=fields&$filter=${f}&$top=500`);

// 5. SIN $filter, SOLO $orderby (¿el orderby solo rompe?)
await probe('SOLO $orderby Fecha desc + $top=50 (sin filtro)',
  `${base}?$expand=fields&$top=50&$orderby=fields/Fecha_N desc`);

// 6. SIN $filter SIN $orderby (control: esto siempre anda)
await probe('control: $top=5 sin filtro sin orderby',
  `${base}?$expand=fields&$top=5`);

console.log();
