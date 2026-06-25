/**
 * Probe read-only: como Fecha_N SÍ está indexada, filtramos por Fecha_N >= now-48h (query indexada,
 * confiable sin importar el tamaño de la lista) para ver QUÉ notis recientes existen de verdad y de
 * qué usuarios. Después, para cada usuario con notis recientes, contamos su total y corremos la query
 * EXACTA de la campanita para ver si le devuelve esas recientes o no.
 *
 * Uso: ENTORNO=PRODUCTIVO npx tsx scripts/probe-notifs-recent2.mts
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
const { graphFetch } = await import('../api/graph.js');
const base = `/sites/${SITE_ID}/lists/${LIST_ID}/items`;
const H = { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } as any;

// Cutoff 48h en ISO (Fecha_N se guarda ISO con Z).
const cutoffIso = new Date(Date.now() - 48 * 3600e3).toISOString();
console.log(`ENTORNO=${ENTORNO}  cutoff(48h)=${cutoffIso}\n`);

// 1) Query INDEXADA por Fecha_N >= cutoff (paginar). Esto debería ser confiable.
const recent: any[] = [];
let next: string | null = `${base}?$expand=fields&$top=500&$filter=${encodeURIComponent(`fields/Fecha_N ge '${cutoffIso}'`)}`;
let pages = 0, httpErr = '';
while (next && recent.length < 10000) {
  const r: any = await graphFetch(next, { headers: H });
  if (!r.ok) { httpErr = `${r.status}: ${(await r.text()).slice(0, 200)}`; break; }
  const d: any = await r.json();
  for (const it of d.value ?? []) recent.push(it);
  pages++;
  const raw = d['@odata.nextLink'] as string | undefined;
  next = raw ? raw.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
}
console.log(`[Fecha_N >= cutoff] pages=${pages} rows=${recent.length}${httpErr ? ' HTTP_ERR=' + httpErr : ''}`);

const recProd = recent.filter(it => String((it.fields ?? {}).Entorno_N ?? '') === ENTORNO);
console.log(`   de esos, Entorno=${ENTORNO}: ${recProd.length}`);
const byUser = new Map<string, number>();
for (const it of recProd) { const u = String((it.fields ?? {}).UserId_N ?? '?'); byUser.set(u, (byUser.get(u) ?? 0) + 1); }
console.log('   usuarios con notis en 48h (userId → #):', [...byUser.entries()].sort((a, b) => b[1] - a[1]).map(([u, c]) => `${u}:${c}`).join('  ') || '(ninguno)');

// 2) Para cada usuario con recientes: total de filas + qué devuelve la query de la campanita.
async function totalForUser(u: string): Promise<number> {
  let n = 0; let nx: string | null = `${base}?$select=id&$top=500&$filter=${encodeURIComponent(`fields/UserId_N eq ${u} and fields/Entorno_N eq '${ENTORNO}'`)}`;
  while (nx && n < 50000) {
    const r: any = await graphFetch(nx, { headers: H }); if (!r.ok) return -1;
    const d: any = await r.json(); n += (d.value ?? []).length;
    const raw = d['@odata.nextLink'] as string | undefined; nx = raw ? raw.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
  }
  return n;
}
async function campanitaQuery(u: string) {
  // EXACTA: $filter UserId+Entorno + $orderby Fecha desc + $top=500 (lo que hace ?window=24h, 1ra página)
  const url = `${base}?$expand=fields&$top=500&$orderby=fields/Fecha_N desc&$filter=${encodeURIComponent(`fields/UserId_N eq ${u} and fields/Entorno_N eq '${ENTORNO}'`)}`;
  const r: any = await graphFetch(url, { headers: H });
  if (!r.ok) return { ok: false, status: r.status, count: 0, max: '—', in48: 0 };
  const d: any = await r.json();
  const rows = d.value ?? [];
  const times = rows.map((it: any) => new Date(String((it.fields ?? {}).Fecha_N ?? '')).getTime()).filter(Number.isFinite);
  const cut = Date.now() - 48 * 3600e3;
  return { ok: true, status: 200, count: rows.length, max: times.length ? new Date(Math.max(...times)).toISOString() : '—', in48: times.filter((t: number) => t >= cut).length };
}

console.log('\n--- por usuario con recientes: total filas vs lo que ve la campanita ---');
for (const [u, recCount] of [...byUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  const total = await totalForUser(u);
  const cq = await campanitaQuery(u);
  const verdict = cq.in48 >= recCount ? 'OK (las trae)' : `BUG (campanita ve ${cq.in48}/${recCount} recientes)`;
  console.log(`   user=${u.padEnd(5)} | total=${String(total).padStart(5)} | recientes48h(real)=${String(recCount).padStart(3)} | campanitaQuery: count=${cq.count} max=${cq.max} in48=${cq.in48} → ${verdict}`);
}
console.log();
