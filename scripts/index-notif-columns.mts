/**
 * Indexa (best-effort) las columnas de 10.Notificaciones que usan las queries de la campanita:
 * UserId_N, Fecha_N, Entorno_N. Con índices, el $filter/$orderby sobre esas columnas deja de
 * pegar contra el list-view threshold de SharePoint y la campanita vuelve a traer las notis de 24h.
 *
 * Uso: npx tsx scripts/index-notif-columns.mts
 *
 * MUTA metadata de SharePoint (NO toca datos — solo marca columnas como indexadas; idempotente).
 * Nota: si la lista todavía supera ~5000 ítems, SP puede rechazar la creación del índice; en ese
 * caso correr primero el cron de poda (cron-cleanup-notifs) hasta drenar el backlog y reintentar,
 * o indexar desde la UI de SharePoint (Configuración de lista → Columnas indexadas) o con PnP
 * PowerShell: Set-PnPField -List "10.Notificaciones" -Identity UserId_N -Values @{Indexed=$true}.
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
const TARGET = ['UserId_N', 'Fecha_N', 'Entorno_N', 'Status_N'];
const { graphFetch } = await import('../api/graph.js');

const colsRes = await graphFetch(`/sites/${SITE_ID}/lists/${LIST_ID}/columns?$select=id,name,indexed`);
if (!colsRes.ok) { console.error('No pude listar columnas:', colsRes.status, (await colsRes.text()).slice(0, 300)); process.exit(1); }
const cols = ((await colsRes.json()) as { value: { id: string; name: string; indexed?: boolean }[] }).value ?? [];

for (const name of TARGET) {
  const col = cols.find(c => c.name === name);
  if (!col) { console.log(`   ${name.padEnd(12)} → NO ENCONTRADA en la lista`); continue; }
  if (col.indexed) { console.log(`   ${name.padEnd(12)} → ya estaba indexada ✓`); continue; }
  const r = await graphFetch(`/sites/${SITE_ID}/lists/${LIST_ID}/columns/${col.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ indexed: true }),
  });
  if (r.ok) console.log(`   ${name.padEnd(12)} → INDEXADA ✓`);
  else console.log(`   ${name.padEnd(12)} → FALLÓ (${r.status}): ${(await r.text()).slice(0, 200)}`);
}
console.log('\nListo. Si alguna falló por tamaño de lista, drená primero con el cron de poda y reintentá.');
