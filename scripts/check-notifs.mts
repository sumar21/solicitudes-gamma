/**
 * Diagnóstico read-only: inspecciona 10.Notificaciones para entender por qué la campanita
 * "queda vacía" tras leer + refrescar. Reporta: distribución por Entorno_N, por Status_N
 * (Enviada/Leida), por UserId_N (últimas 48h), y las filas más recientes. Verifica también
 * que Fecha_N parsee bien (de eso depende el recorte a 24h del endpoint).
 *
 * Uso: npx tsx scripts/check-notifs.mts
 * NO escribe nada. Borrable.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

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
const LIST_ID = '240f00dd-715b-4c78-9661-3147b7650a0f'; // 10.Notificaciones
console.log('ENTORNO en .env.local =', process.env.ENTORNO ?? '(no seteado → default TESTING)');

const { graphFetch } = await import('../api/graph.js');

const rows: any[] = [];
let next: string | null = `/sites/${SITE_ID}/lists/${LIST_ID}/items?$expand=fields&$top=500`;
while (next && rows.length < 20_000) {
  const r = await graphFetch(next, { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } as any });
  if (!r.ok) { console.error('Graph error', r.status, (await r.text()).slice(0, 200)); process.exit(1); }
  const data = (await r.json()) as { value?: any[]; '@odata.nextLink'?: string };
  for (const it of data.value ?? []) rows.push(it);
  const raw = data['@odata.nextLink'];
  next = raw ? raw.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null;
}

console.log(`\nTotal items en 10.Notificaciones: ${rows.length}`);

// Distribución por Entorno_N
const byEnt = new Map<string, number>();
for (const it of rows) {
  const ent = String((it.fields ?? {}).Entorno_N ?? '(vacío)');
  byEnt.set(ent, (byEnt.get(ent) ?? 0) + 1);
}
console.log('\n--- Por Entorno_N ---');
for (const [ent, c] of [...byEnt.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${ent.padEnd(14)} | ${c}`);

// Recientes (48h) por Fecha_N — y chequeo de parseo
const now = Date.now();
const cutoff48 = now - 48 * 60 * 60 * 1000;
const cutoff24 = now - 24 * 60 * 60 * 1000;
let unparsable = 0;
const recent48 = rows.filter(it => {
  const raw = String((it.fields ?? {}).Fecha_N ?? '');
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) { unparsable++; return false; }
  return t >= cutoff48;
});
const recent24 = recent48.filter(it => new Date(String((it.fields ?? {}).Fecha_N ?? '')).getTime() >= cutoff24);

console.log(`\nFechas que NO parsean (NaN → se caerían del recorte 24h): ${unparsable}`);
console.log(`Filas últimas 48h: ${recent48.length} | últimas 24h: ${recent24.length}`);

// Status en últimas 24h
const byStatus = new Map<string, number>();
for (const it of recent24) {
  const s = String((it.fields ?? {}).Status_N ?? '(vacío)');
  byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
}
console.log('\n--- Status_N (últimas 24h) — si NO hay "Leida", la campanita igual debería mostrarlas ---');
for (const [s, c] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${s.padEnd(12)} | ${c}`);

// Por UserId_N en últimas 24h
const byUser = new Map<string, { total: number; leida: number; enviada: number; sample: string }>();
for (const it of recent24) {
  const f = it.fields ?? {};
  const u = String(f.UserId_N ?? '(vacío)');
  const cur = byUser.get(u) ?? { total: 0, leida: 0, enviada: 0, sample: String(f.Title_N ?? '') };
  cur.total++;
  if (String(f.Status_N) === 'Leida') cur.leida++; else cur.enviada++;
  byUser.set(u, cur);
}
console.log('\n--- Por UserId_N (últimas 24h) — total | Leida | Enviada ---');
for (const [u, v] of [...byUser.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 25)) {
  console.log(`   user=${u.padEnd(6)} | ${String(v.total).padStart(4)} | L=${String(v.leida).padStart(4)} | E=${String(v.enviada).padStart(4)}`);
}

// Las 15 más recientes
const recent = rows
  .map(it => it.fields ?? {})
  .sort((a, b) => String(b.Fecha_N ?? '').localeCompare(String(a.Fecha_N ?? '')))
  .slice(0, 15);
console.log('\n--- 15 notifs más recientes ---');
for (const f of recent) {
  console.log(`   ${String(f.Fecha_N ?? '—')} | Ent=${String(f.Entorno_N ?? '?').padEnd(10)} | u=${String(f.UserId_N ?? '?').padEnd(5)} | ${String(f.Status_N ?? '?').padEnd(8)} | ${String(f.Type_N ?? '?').padEnd(14)} | ${String(f.Title_N ?? '')}`);
}
console.log();
