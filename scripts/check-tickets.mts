/**
 * Diagnóstico read-only: inspecciona 07.Traslados para entender por qué un ticket
 * recién creado "desaparece". Reporta: distribución por Entorno_T (count + último
 * FechaInicio_T) y los N tickets más recientes (id, Entorno_T, Status_T, fecha, usuario).
 *
 * Uso: npx tsx scripts/check-tickets.mts
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
const LIST_ID = 'c7417674-9084-416d-a955-7024161a3194'; // 07.Traslados
console.log('ENTORNO en .env.local =', process.env.ENTORNO ?? '(no seteado → default TESTING)');

const { graphFetch } = await import('../api/graph.js');

// Paginar todo (igual que api/tickets.ts GET).
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

console.log(`\nTotal items en 07.Traslados: ${rows.length}`);

// Distribución por Entorno_T
const byEnt = new Map<string, { count: number; latest: string }>();
for (const it of rows) {
  const f = it.fields ?? {};
  const ent = String(f.Entorno_T ?? '(vacío)');
  const fecha = String(f.FechaInicio_T ?? '');
  const cur = byEnt.get(ent) ?? { count: 0, latest: '' };
  cur.count++;
  if (fecha > cur.latest) cur.latest = fecha;
  byEnt.set(ent, cur);
}
console.log('\n--- Distribución por Entorno_T (count | último FechaInicio_T) ---');
for (const [ent, v] of [...byEnt.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`   ${ent.padEnd(14)} | ${String(v.count).padStart(5)} | ${v.latest || '—'}`);
}

// Los 12 tickets más recientes (por FechaInicio_T)
const recent = rows
  .map(it => it.fields ?? {})
  .sort((a, b) => String(b.FechaInicio_T ?? '').localeCompare(String(a.FechaInicio_T ?? '')))
  .slice(0, 12);
console.log('\n--- 12 tickets más recientes (por FechaInicio_T) ---');
for (const f of recent) {
  console.log(`   ${String(f.FechaInicio_T ?? '—')} | Ent=${String(f.Entorno_T ?? '(vacío)').padEnd(11)} | ${String(f.Status_T ?? '—').padEnd(20)} | ${String(f.IDUnivocoTraslado_T ?? '—')} | ${String(f.Paciente_T ?? '')} | by ${String(f.Usuario_T ?? '—')}`);
}
console.log();
